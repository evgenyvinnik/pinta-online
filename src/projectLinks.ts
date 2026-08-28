/**
 * External links the browser edition points at. Shared between `App` and the About dialog, which
 * is why they live here rather than in either: a constant imported from a component would make
 * the component's module a dependency of its own consumer.
 */
export const WEB_REPOSITORY_URL = 'https://github.com/evgenyvinnik/pinta-online';
export const WEB_BUG_REPORT_URL = `${WEB_REPOSITORY_URL}/issues/new?template=bug.md`;
export const USER_GUIDE_URL = '/user-guide/';
