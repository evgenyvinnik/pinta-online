const search = document.querySelector('[data-guide-search]');
const chapters = [...document.querySelectorAll('[data-chapter]')];
const navigationLinks = [...document.querySelectorAll('.guide-sidebar nav a')];
const searchStatus = document.querySelector('[data-search-status]');
const noResults = document.querySelector('[data-no-results]');
const progress = document.querySelector('[data-reading-progress]');
const progressLabel = document.querySelector('[data-progress-label]');

function normalize(value) {
  return value.toLocaleLowerCase().normalize('NFKD').replaceAll(/\p{Diacritic}/gu, '');
}

function updateSearch() {
  const query = normalize(search?.value.trim() ?? '');
  let visible = 0;
  for (const chapter of chapters) {
    const matches = !query || normalize(chapter.textContent ?? '').includes(query);
    chapter.hidden = !matches;
    visible += matches ? 1 : 0;
    const link = navigationLinks.find((item) => item.hash === `#${chapter.id}`);
    if (link) link.hidden = !matches;
  }
  if (searchStatus) searchStatus.textContent = query ? `${visible} matching ${visible === 1 ? 'section' : 'sections'}` : `${chapters.length} guide sections`;
  if (noResults) noResults.hidden = visible !== 0;
}

search?.addEventListener('input', updateSearch);
updateSearch();
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const editing = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  if (event.key === '/' && !editing) {
    event.preventDefault();
    search?.focus();
  } else if (event.key === 'Escape' && document.activeElement === search && search?.value) {
    search.value = '';
    updateSearch();
  }
});

const chapterObserver = new IntersectionObserver((entries) => {
  const current = entries
    .filter((entry) => entry.isIntersecting)
    .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
  if (!current) return;
  for (const link of navigationLinks) {
    if (link.hash === `#${current.target.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}, { rootMargin: '-20% 0px -68% 0px', threshold: 0 });
for (const chapter of chapters) chapterObserver.observe(chapter);

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const percentage = scrollable > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100))) : 100;
  if (progress) progress.value = percentage;
  if (progressLabel) progressLabel.textContent = `${percentage}%`;
}
updateProgress();
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);
