// js/image-viewer.js — shared fullscreen image viewer
// ================================================================
// IMAGE VIEWER MODAL
// ================================================================
let _viewerImages = [];
let _viewerIndex  = 0;
let _viewerTitle  = '';

function _injectImageViewer() {
  if (document.getElementById('imgViewerOverlay')) return;
  const el = document.createElement('div');
  el.id        = 'imgViewerOverlay';
  el.className = 'img-viewer-overlay';
  el.style.zIndex = '9999'; 
  el.innerHTML = `
    <div class="img-viewer" id="imgViewer">
      <div class="img-viewer__topbar">
        <span class="img-viewer__title"   id="imgViewerTitle"></span>
        <span class="img-viewer__counter" id="imgViewerCounter"></span>
        <button class="img-viewer__close" id="imgViewerClose" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="img-viewer__stage">
        <button class="img-viewer__arrow img-viewer__arrow--prev" id="imgViewerPrev" aria-label="Previous">
          <i data-lucide="chevron-left"></i>
        </button>
        <div class="img-viewer__strip" id="imgViewerStrip"></div>
        <button class="img-viewer__arrow img-viewer__arrow--next" id="imgViewerNext" aria-label="Next">
          <i data-lucide="chevron-right"></i>
        </button>
      </div>
      <div class="img-viewer__bottombar">
        <div class="img-viewer__dots" id="imgViewerDots"></div>
        <div class="img-viewer__accent"></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  lucide.createIcons({ el });

  el.addEventListener('click', e => { if (e.target === el) _closeViewer(); });
  document.getElementById('imgViewerClose').addEventListener('click', _closeViewer);
  document.getElementById('imgViewerPrev').addEventListener('click', () => _viewerNav(-1));
  document.getElementById('imgViewerNext').addEventListener('click', () => _viewerNav(1));

  document.addEventListener('keydown', e => {
    if (!document.getElementById('imgViewerOverlay')?.classList.contains('is-open')) return;
    if (e.key === 'ArrowLeft')  _viewerNav(-1);
    if (e.key === 'ArrowRight') _viewerNav(1);
    if (e.key === 'Escape')     _closeViewer();
  });

  let _viewerWheelLock = false;
document.getElementById('imgViewerStrip').addEventListener('wheel', e => {
  if (!document.getElementById('imgViewerOverlay')?.classList.contains('is-open')) return;
  if (_viewerImages.length <= 1) return;
  e.preventDefault();
  if (_viewerWheelLock) return;
  _viewerWheelLock = true;
  _viewerNav(e.deltaY > 0 ? 1 : -1);
  setTimeout(() => { _viewerWheelLock = false; }, 600);
}, { passive: false });
}

function _openViewer(images, index, title) {
  _injectImageViewer();                                        
  _viewerImages = Array.isArray(images) ? images : [images];
  _viewerIndex  = index ?? 0;
  _viewerTitle  = title ?? '';
  _renderViewer();
  document.getElementById('imgViewerOverlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function _closeViewer() {
  document.getElementById('imgViewerOverlay')?.classList.remove('is-open');
  document.body.style.overflow = '';
}

function _viewerNav(dir) {
  const next = (_viewerIndex + dir + _viewerImages.length) % _viewerImages.length;
  _goToSlide(next);
}

function _renderViewer() {
  const strip   = document.getElementById('imgViewerStrip');
  const title   = document.getElementById('imgViewerTitle');
  const counter = document.getElementById('imgViewerCounter');
  const dots    = document.getElementById('imgViewerDots');
  const viewer  = document.getElementById('imgViewer');
  if (!strip) return;

  title.textContent   = _viewerTitle;
  counter.textContent = _viewerImages.length > 1 ? `${_viewerIndex + 1} / ${_viewerImages.length}` : '';
  viewer.classList.toggle('img-viewer--single', _viewerImages.length === 1);

  // Build all slides in the strip
  strip.innerHTML = _viewerImages.map((url, i) => `
    <div class="img-viewer__slide">
      <img class="img-viewer__img" src="${url}" alt="${_viewerTitle} ${i + 1}" loading="eager" style="opacity:0;" onload="this.style.opacity='1'" />
    </div>`).join('');

  // Scroll to current index instantly
  requestAnimationFrame(() => {
    strip.style.scrollBehavior = 'auto';
    strip.scrollLeft = strip.offsetWidth * _viewerIndex;
    strip.style.scrollBehavior = 'smooth';
  });

  // Rebuild dots
  dots.innerHTML = _viewerImages.map((_, i) => `
    <button class="img-viewer__dot${i === _viewerIndex ? ' is-active' : ''}"
      aria-label="Image ${i + 1}"></button>`).join('');
  dots.querySelectorAll('.img-viewer__dot').forEach((dot, i) => {
    dot.addEventListener('click', () => { _viewerIndex = i; _goToSlide(i); });
  });
}

function _goToSlide(index) {
  _viewerIndex = index;
  const strip   = document.getElementById('imgViewerStrip');
  const counter = document.getElementById('imgViewerCounter');
  const dots    = document.getElementById('imgViewerDots');
  if (strip) strip.scrollLeft = strip.offsetWidth * index;
  if (counter) counter.textContent = _viewerImages.length > 1 ? `${index + 1} / ${_viewerImages.length}` : '';
  dots?.querySelectorAll('.img-viewer__dot').forEach((d, i) => d.classList.toggle('is-active', i === index));
}

// Expose globally so onclick in HTML can call it
window.openImageViewer = _openViewer;

export { _openViewer as openImageViewer, _injectImageViewer };