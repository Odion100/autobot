export default function filterAnchors({ anchors, subSelector }) {
  const matchedElements = new Set();

  return anchors.split(",").filter((selector) => {
    try {
      const element = document.querySelector(`${selector} ${subSelector}`);

      if (element && !matchedElements.has(element)) {
        matchedElements.add(element);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  });
}
