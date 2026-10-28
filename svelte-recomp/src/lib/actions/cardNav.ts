import { goto } from '$app/navigation';

// Reusable "whole card is a tap target" behaviour (DRY). Attach with
// `use:cardNav={'/somewhere'}` on any card and the entire card navigates
// there on click / Enter / Space. Clicks that originate from a genuinely
// interactive child (button, link, input, textarea, select, label, or any
// element marked data-no-nav) are ignored, so inline controls inside the
// card still work without manual stopPropagation everywhere.
export function cardNav(node: HTMLElement, href: string) {
  let target = href;
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.classList.add('card-tap');

  const isInteractive = (start: EventTarget | null): boolean => {
    let el = start as HTMLElement | null;
    while (el && el !== node) {
      const tag = el.tagName;
      if (
        tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
        tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'LABEL' ||
        (el.dataset && el.dataset.noNav !== undefined)
      ) return true;
      el = el.parentElement;
    }
    return false;
  };

  const onClick = (e: MouseEvent) => {
    if (isInteractive(e.target)) return;
    goto(target);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (isInteractive(e.target)) return;
    e.preventDefault();
    goto(target);
  };

  node.addEventListener('click', onClick);
  node.addEventListener('keydown', onKey);

  return {
    update(next: string) { target = next; },
    destroy() {
      node.removeEventListener('click', onClick);
      node.removeEventListener('keydown', onKey);
    },
  };
}
