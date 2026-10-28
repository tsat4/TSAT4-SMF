import { mx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { atLeast, rankIn } from '../../core/access.js';
import { requireUser } from '../../core/users.js';
import { centersForDepartments } from '../../core/master.js';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function readAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function monthOf(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  return {
    year: Number(parts.find((part) => part.type === 'year').value),
    month: Number(parts.find((part) => part.type === 'month').value)
  };
}

function topRows(map, pick, limit = 10) {
  return [...map.values()].sort((a, b) => pick(b) - pick(a) || String(a.material).localeCompare(String(b.material))).slice(0, limit);
}

export function mountDashboard(app, mod) {
  app.get('/api/usage-dashboard', wrap(requireUser), atLeast(mod, 1), wrap(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    if (year < 2000 || year > 2100) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const wide = rankIn(req.user, mod.id) >= 3 || Boolean(req.user.executive);
    let codes = null;
    if (!wide) {
      const grouped = await centersForDepartments([req.user.department || '']);
      codes = (grouped.get(req.user.department) || []).map((row) => row.costcenter);
    }

    const materials = await readAll(() => mx.from('mt_sto_usage')
      .select('material,material_description,bun,price,usage_group,status')
      .eq('status', 'Active')
      .order('material'));
    const byMaterial = new Map(materials.map((row) => [row.material, row]));
    const useGroup = materials.some((row) => String(row.usage_group || '').trim());
    const groupName = (row) => {
      const group = String(row?.usage_group || '').trim();
      if (useGroup) return group || 'ยังไม่จัดกลุ่ม';
      return String(row?.bun || '').trim() || 'ไม่ระบุหน่วย';
    };

    const issues = !codes || codes.length
      ? await readAll(() => {
        let query = mx.from('tx_sto_issue').select('material,qty,issued_at,costcenter')
          .gte('issued_at', `${year}-01-01T00:00:00+07`)
          .lt('issued_at', `${year + 1}-01-01T00:00:00+07`)
          .order('id');
        if (codes) query = query.in('costcenter', codes);
        return query;
      })
      : [];
    const stock = !codes || codes.length
      ? await readAll(() => {
        let query = mx.from('mt_sto_stock').select('material,current_qty,costcenter').order('costcenter').order('material');
        if (codes) query = query.in('costcenter', codes);
        return query;
      })
      : [];

    const months = MONTHS.map((label, index) => ({ month: index + 1, label, inQty: 0, outQty: 0, outValue: 0 }));
    const moved = new Map();
    for (const row of issues) {
      const when = monthOf(row.issued_at);
      if (when.year !== year) continue;
      const qty = Number(row.qty) || 0;
      const price = Number(byMaterial.get(row.material)?.price) || 0;
      const bucket = months[when.month - 1];
      bucket.outQty = round2(bucket.outQty + qty);
      bucket.outValue = round2(bucket.outValue + qty * price);
      const item = moved.get(row.material) || { material: row.material, qty: 0, value: 0 };
      item.qty = round2(item.qty + qty);
      item.value = round2(item.value + qty * price);
      moved.set(row.material, item);
    }

    const groups = new Map();
    for (const row of materials) {
      const name = groupName(row);
      const item = groups.get(name) || { name, count: 0, value: 0 };
      item.count += 1;
      item.value = round2(item.value + (Number(row.price) || 0));
      groups.set(name, item);
    }
    const issuedGroups = new Map();
    for (const row of moved.values()) {
      const name = groupName(byMaterial.get(row.material));
      const item = issuedGroups.get(name) || { name, count: 0, value: 0 };
      item.count += 1;
      item.value = round2(item.value + row.value);
      issuedGroups.set(name, item);
    }
    const donutSource = issuedGroups.size ? issuedGroups : groups;
    const donutTotal = [...donutSource.values()].reduce((sum, row) => sum + row.value, 0);
    const rankedGroups = [...donutSource.values()].sort((a, b) => b.value - a.value || b.count - a.count);
    const head = rankedGroups.slice(0, 7);
    const rest = rankedGroups.slice(7);
    const slices = head.map((row) => ({
      name: row.name,
      count: row.count,
      value: round2(row.value),
      share: donutTotal ? round2(row.value * 100 / donutTotal) : 0
    }));
    if (rest.length) {
      const value = rest.reduce((sum, row) => sum + row.value, 0);
      slices.push({
        name: 'อื่นๆ',
        count: rest.reduce((sum, row) => sum + row.count, 0),
        value: round2(value),
        share: donutTotal ? round2(value * 100 / donutTotal) : 0
      });
    }

    const describe = (row) => {
      const master = byMaterial.get(row.material) || {};
      return {
        material: row.material,
        name: master.material_description || row.material,
        bun: master.bun || '',
        qty: round2(row.qty || 0),
        value: round2(row.value || 0),
        price: round2(master.price)
      };
    };
    const issuedMaterials = new Set(moved.keys());
    const idlePool = stock.length
      ? [...stock.reduce((map, row) => {
        const item = map.get(row.material) || { material: row.material, qty: 0 };
        item.qty += Number(row.current_qty) || 0;
        map.set(row.material, item);
        return map;
      }, new Map()).values()].filter((row) => !issuedMaterials.has(row.material)).map((row) => ({
        ...row,
        value: round2(row.qty * (Number(byMaterial.get(row.material)?.price) || 0))
      }))
      : materials.filter((row) => !issuedMaterials.has(row.material)).map((row) => ({
        material: row.material,
        qty: 0,
        value: round2(row.price)
      }));

    const today = monthOf(new Date().toISOString());
    const focus = year === today.year ? today.month : 12;
    const current = months[focus - 1];
    const previous = focus > 1 ? months[focus - 2] : null;
    const stockQty = stock.reduce((sum, row) => sum + (Number(row.current_qty) || 0), 0);
    const stockValue = stock.reduce((sum, row) => sum + (Number(row.current_qty) || 0) * (Number(byMaterial.get(row.material)?.price) || 0), 0);

    res.json({
      year,
      scope: wide ? 'ทั้ง Usage' : (req.user.department || 'ยังไม่มีหน่วยงาน'),
      groupBy: useGroup ? 'กลุ่ม' : 'หน่วยนับ',
      donut: issuedGroups.size ? 'มูลค่าจ่ายออก' : 'ราคาต่อหน่วยรวม',
      inbound: false,
      idleBasis: stock.length ? 'stock' : 'catalog',
      kpis: {
        items: materials.length,
        groups: groups.size,
        outQty: round2(months.reduce((sum, row) => sum + row.outQty, 0)),
        outValue: round2(months.reduce((sum, row) => sum + row.outValue, 0)),
        inQty: 0,
        stockQty: round2(stockQty),
        stockValue: round2(stockValue),
        focus,
        outQtyNow: current.outQty,
        outQtyPrev: previous ? previous.outQty : null,
        outValueNow: current.outValue,
        outValuePrev: previous ? previous.outValue : null
      },
      slices,
      months,
      topQty: topRows(moved, (row) => row.qty).map(describe),
      topValue: topRows(moved, (row) => row.value).map(describe),
      idle: topRows(new Map(idlePool.map((row) => [row.material, row])), (row) => row.value || row.price || 0).map(describe)
    });
  }));
}
