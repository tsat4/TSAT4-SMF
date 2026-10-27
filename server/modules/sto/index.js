import { defineModule } from '../../core/access.js';
import { STO_TABLES } from './tables.js';
import { mountMembers } from './members.js';
import { mountMaterials } from './materials.js';
import { mountRequisitions } from './requisitions.js';
import { mountDashboard } from './dashboard.js';
import { mountLedger } from './ledger.js';

// ระบบงาน > Store > Usage: members, material master, stock, and requisitions.
export default defineModule({
  id: 'sto',
  label: 'Usage',
  memberTable: 'mt_sto_user',
  tables: STO_TABLES,
  mount(app, mod) {
    mountMembers(app, mod);
    mountMaterials(app, mod);
    mountRequisitions(app, mod);
    mountDashboard(app, mod);
    mountLedger(app, mod);
  }
});
