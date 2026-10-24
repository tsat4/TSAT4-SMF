import { mx } from './db.js';

// Shared master data (mt_main_*) that every module may read.

export async function centersForDepartments(departments) {
  const names = [...new Set(departments.map((name) => String(name || '').trim()).filter(Boolean))];
  const grouped = new Map();
  if (!names.length) return grouped;
  const { data, error } = await mx.from('mt_main_costcenter')
    .select('costcenter,object_name,department')
    .eq('status', 'Active')
    .in('department', names)
    .order('costcenter');
  if (error) throw error;
  for (const row of data || []) {
    const list = grouped.get(row.department) || [];
    list.push({ costcenter: row.costcenter, objectName: row.object_name });
    grouped.set(row.department, list);
  }
  return grouped;
}

export async function costcenterMap(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await mx
    .from('mt_main_costcenter')
    .select('costcenter,object_name,department')
    .in('costcenter', unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.costcenter, row]));
}

// The cost center is Active and belongs to the signed-in user's department.
export async function ownCenter(req, costcenter) {
  const center = await mx.from('mt_main_costcenter').select('department,status').eq('costcenter', costcenter).maybeSingle();
  if (!center.data || center.data.status !== 'Active' || center.data.department !== req.user.department) return null;
  return center.data;
}
