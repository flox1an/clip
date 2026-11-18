// One authored set: 24px grid, 2px round strokes, currentColor.
const paths = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  flip: '<path d="M4 8.5A8 8 0 0 1 18.4 6M20 15.5A8 8 0 0 1 5.6 18"/><path d="M18.8 2.6V6.4H15M5.2 21.4v-3.8H9"/><circle cx="12" cy="12" r="2.6"/>',
  speed: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13.2l4-4.4"/><circle cx="12" cy="13.6" r="1.2" fill="currentColor"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
  gallery: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="9" cy="9" r="1.6"/><path d="M20.5 15.5l-4.5-4.5-9.5 9.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  backspace: '<path d="M8.6 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.6L3 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v5.5M14 10.5v5.5"/>',
  split: '<circle cx="6" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><path d="M8.2 8 20 18M8.2 16 20 6"/>',
  left: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  right: '<path d="M14 6l6 6-6 6M20 12H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 3.5v12M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  download: '<path d="M12 3.5v12M7.5 11 12 15.5 16.5 11"/><path d="M4.5 20.5h15"/>',
  camera: '<path d="M3.5 8a2 2 0 0 1 2-2h2l1.6-2h5.8l1.6 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>',
  filter: '<circle cx="12" cy="8.5" r="5"/><circle cx="8.2" cy="15" r="5"/><circle cx="15.8" cy="15" r="5"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
};

export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
