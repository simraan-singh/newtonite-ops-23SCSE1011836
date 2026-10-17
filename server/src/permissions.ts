const rank = { VIEWER: 1, MEMBER: 2, LEAD: 3, ADMIN: 4 } as const;
const need = { read: 1, write: 2, approve: 3, reassign: 3 } as const;

export type Role = keyof typeof rank;
export type Action = keyof typeof need;
export type AuthUser = { id: number; roles: Record<number, Role> };

// Every endpoint checks permissions through this single function
export function can(user: AuthUser, action: Action, teamId: number): boolean {
  const role = user.roles[teamId];
  return !!role && rank[role] >= need[action];
}
