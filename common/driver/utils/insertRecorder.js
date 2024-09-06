export default function (watchList) {
  window.watchList = watchList;
  window.interactions = [];
  const style = `
    <style id="cambrian-ai-recorder-display">
      #cambrian-ai-containers .cambrian-ai-side-button-holder {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: white;
        padding: 3px;
        border-radius: 54px;
        display: inline-block;
        border: 1px solid red;
        margin: 0 0px 0px 4px;
        opacity: .9;
      }
      #cambrian-ai-containers .cambrian-ai-side-button-holder:hover {
        opacity: 1;
      }
      #cambrian-ai-containers .cambrian-ai-recorder-button {
        width: 27px;
        height: 27px;
        background-color: #4CAF50;
        border: none;
        border-radius: 26px;
        font-size: 13px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        opacity: 0.9;
        transition: all 0.3s ease;
        padding: 5px 5px;
        font-weight: bold;
      }
      #cambrian-ai-containers .cambrian-ai-recorder-button:hover {
        opacity: 1;
      }
    </style>
  `;
  // Define the button HTML as a string
  const buttonHTML = `
    <div class="cambrian-ai-side-button-holder">
      <button class="cambrian-ai-recorder-button" id="stopRecorderButton">
        <span style="width: 12px;height: 12px;background: #b12b40;"></span>
      </button>
    </div>
    `;
  console.log("here0");

  // Insert the button HTML into the page
  const container = document.querySelector("#cambrian-ai-containers");
  container.insertAdjacentHTML("beforeend", buttonHTML);
  if (!container.querySelector("style#cambrian-ai-recorder-display")) {
    container.insertAdjacentHTML("afterbegin", style);
  }
  console.log("here1");
  // Function to handle clicks on interactive elements
  function clickHandler(event) {
    console.log("clickHandler", watchList, event.target);
    const element = event.target;
    const identifier = window.watchList.find(({ selector }) => element.matches(selector));
    console.log("c identifier, element", identifier, element);
    if (identifier) {
      const alreadyClicked = window.interactions.find(
        ({ selector }) => identifier.selector === selector
      );
      if (alreadyClicked) {
        window.interactions = window.interactions
          .filter(({ selector }) => selector !== alreadyClicked.selector)
          .map((item, i) => ({ ...item, number: i + 1 }));
        window.saveInteraction(window.interactions);
      } else {
        console.log(element, "element");
        console.log(identifier, "identifier");
        window.interactions.push(identifier);
        window.saveInteraction({
          ...identifier,
          innerText: element.textContent,
          timestamp: new Date().toISOString(),
          number: window.interactions.length,
        });
      }
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }

  document.addEventListener("click", clickHandler, true);
  console.log("here2");

  function stopRecording() {
    console.log("stopping the recorder");
    document.removeEventListener("click", clickHandler, true);
    window.recordingComplete();
    document
      .querySelector("#cambrian-ai-containers .cambrian-ai-side-button-holder")
      .remove();
  }
  // Get a reference to the inserted button
  const button = document.getElementById("stopRecorderButton");
  console.log("here3");
  // Toggle recording state when button is clicked
  button.addEventListener("click", () => {
    stopRecording();
  });
  console.log("here4");
}
