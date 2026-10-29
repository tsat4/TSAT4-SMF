// STO tables shown in System > Setting. Column: [name, type, required].
export const STO_TABLES = {
  mt_sto_usage: { db: 'mx', pk: ['material'], columns: [
    ['no', 'int'], ['material', 'text', true], ['material_description', 'text', true], ['bun', 'text', true],
    ['price', 'money', true], ['crcy', 'text', true], ['usage_group', 'text'], ['img', 'text'], ['status', 'status', true]
  ] },
  mt_sto_user: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['department', 'dept', true], ['role', 'usage', true], ['status', 'status', true]
  ] },
  mt_sto_buyer: { db: 'mx', pk: ['costcenter'], columns: [
    ['costcenter', 'text', true], ['status', 'status', true]
  ] },
  mt_sto_stock: { db: 'mx', pk: ['costcenter', 'material'], columns: [
    ['costcenter', 'text', true], ['material', 'text', true], ['min_qty', 'qty', true], ['current_qty', 'qty', true], ['max_qty', 'qty', true]
  ] },
  tx_sto_requisition: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['requested_by', 'text', true], ['costcenter', 'text', true],
    ['status', 'req', true], ['note', 'text'], ['accepted_by', 'text'], ['received_by', 'text']
  ] },
  tx_sto_requisition_line: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['requisition_id', 'int', true], ['costcenter', 'text', true], ['material', 'text', true], ['qty', 'qty', true]
  ] },
  tx_sto_issue: { db: 'mx', pk: ['id'], columns: [
    ['id', 'read'], ['requisition_id', 'int', true], ['requisition_line_id', 'int', true],
    ['costcenter', 'text', true], ['material', 'text', true], ['qty', 'qty', true], ['issued_at', 'read']
  ] }
};
