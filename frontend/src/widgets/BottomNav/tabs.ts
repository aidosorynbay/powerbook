/**
 * The four places a member moves between — the tab bar on phones and the top bar on computers read this one list,
 * so the two can never disagree. Each place also lights for the pages that now live inside it.
 */
export const MEMBER_TABS = [
  { path: '/round', icon: 'clock', label: 'nav.round', also: [] as string[] },
  { path: '/results', icon: 'calendar', label: 'nav2.results', also: ['/archive', '/hall-of-fame'] },
  { path: '/insights', icon: 'user', label: 'nav.profile', also: ['/profile', '/readers', '/reading', '/suggestions', '/get', '/messages'] },
  { path: '/library', icon: 'book', label: 'nav.library', also: ['/books', '/market'] },
] as const;

export function isTabActive(pathname: string, tab: (typeof MEMBER_TABS)[number]): boolean {
  return [tab.path, ...tab.also].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
