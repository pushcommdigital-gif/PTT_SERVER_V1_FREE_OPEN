export function getJwtRoleLevel(): number {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return 0;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.roleLevel === 'number' ? payload.roleLevel : 0;
  } catch {
    return 0;
  }
}
