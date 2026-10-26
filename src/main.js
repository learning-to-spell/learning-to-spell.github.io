/* PLAYBACK */
const playing = new Set();  // videos in view; they play unless globally paused
let paused = false;

const play = (video) => video.play().catch(() => {});

function ready(video) {
  if (video.readyState >= 3) return Promise.resolve();
  video.preload = 'auto';
  video.load();
  return new Promise(resolve => {
    video.addEventListener('canplay', resolve, { once: true });
    video.addEventListener('error',   resolve, { once: true });
  });
}

/* Play a figure's videos together, from the start, while it is in view */
document.querySelectorAll('.viz--video, .vid-pair').forEach(root => {
  const videos = [...root.querySelectorAll('video')];
  let visible = false;
  new IntersectionObserver(entries => {
    visible = entries.at(-1).isIntersecting;
    if (!visible) {
      videos.forEach(v => { playing.delete(v); v.pause(); });
      return;
    }
    Promise.all(videos.map(ready)).then(() => {
      if (!visible) return;
      videos.forEach(v => { v.currentTime = 0; playing.add(v); });
      if (!paused) videos.forEach(play);
    });
  }, { threshold: 0.25 }).observe(root);
});

/* MEDIA TOGGLE */
const toggle = document.querySelector('.media-toggle');
toggle.addEventListener('click', () => {
  paused = !paused;
  toggle.classList.toggle('is-paused', paused);
  toggle.setAttribute('aria-label', paused ? 'Play all media' : 'Pause all media');
  playing.forEach(v => (paused ? v.pause() : play(v)));
});
