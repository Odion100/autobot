export default function getViewport(containers) {
  return containers.reduce((acc, container) => {
    const element = document.querySelector(container.selector);
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Element is in viewport if it is within the visible portion of the page
    if (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= windowHeight &&
      rect.right <= windowWidth
    ) {
      const html = element.outerHtml;
      acc.push(container);
    }
    return acc;
  }, []);
}
