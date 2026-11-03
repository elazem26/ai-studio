(() => {
  window.__tap = (el) => {
    if (!el) return 'no el';
    const r = el.getBoundingClientRect();
    const opts = {bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2, pointerId:1, isPrimary:true};
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    return 'tapped';
  };
  window.__audit = () => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const offscreen = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.right > vw + 2 || r.left < -2) && !el.closest('[data-allow-overflow]')) {
        const st = getComputedStyle(el);
        if (st.position !== 'fixed' || true) {
          offscreen.push({tag: el.tagName, cls: String(el.className).slice(0,60), l: Math.round(r.left), rgt: Math.round(r.right)});
        }
      }
    });
    return {vw, scrollW: doc.scrollWidth, scrollH: doc.scrollHeight, offscreenCount: offscreen.length, sample: offscreen.slice(0, 8)};
  };
  return 'injected';
})()
