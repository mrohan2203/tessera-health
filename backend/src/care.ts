/* Care relationships, computed with the same rules as careRel() in tessera/app.js. The seed uses this
   once; from Phase 4 the API recomputes a patient's relationships whenever their department, consults,
   unit, emergency-board entry or theatre booking changes, so access follows the patient: the receiving
   unit's nurses gain access on admission, the old unit loses it on transfer. */
export interface CareCtx { unitGroups: Record<string, string[]>; onEr: boolean; inOt: boolean; }
export function relationsFor(users: any[], p: any, ctx: CareCtx): { user: string; kind: string }[] {
  const out: { user: string; kind: string }[] = [];
  for (const u of users) {
    if (u.status && u.status !== 'active' && u.status !== 'suspended') continue;
    if (u.role === 'doctor') {
      if (p.dept && p.dept === u.dept) out.push({ user: u.id, kind: 'department' });
      if ((p.consults || []).includes(u.dept)) out.push({ user: u.id, kind: 'consult' });
      if (u.dept === 'EMER' && ctx.onEr) out.push({ user: u.id, kind: 'emergency' });
    }
    if (u.role === 'nurse') {
      if (p.unit && (p.unit === u.unit || (ctx.unitGroups[u.unit] || []).includes(p.unit))) out.push({ user: u.id, kind: 'unit' });
      if (u.unit === 'PERIOP' && ctx.inOt) out.push({ user: u.id, kind: 'theatre' });
    }
  }
  return out;
}
