export default function getViewport(containers) {
  return containers.reduce((acc, container) => {
    const element = document.querySelector(container.selector);
    if (!element) return acc; // Continue to the next container if element is not found
    const style = window.getComputedStyle(element);
    if (style.position === "fixed") {
      acc.push(container);
      return acc;
    }

    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Calculate the visible area of the element within the viewport
    const visibleWidth = Math.min(rect.right, windowWidth) - Math.max(rect.left, 0);
    const visibleHeight = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);

    const visibleArea = Math.max(0, visibleWidth) * Math.max(0, visibleHeight);
    const elementArea = rect.width * rect.height;

    // Check if the visible area is at least 50% of the element's total area
    if (visibleArea / elementArea >= 0.05) {
      acc.push(container);
    }
    return acc;
  }, []);
}
