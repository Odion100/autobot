const defaultFunctions = `- navigate(url): Navigates to the given URL.
- findAndClick(elementDescription): Clicks on the first element matching a natural language description of the item you want to click. For example "shopping cart button".
- findAndType(elementDescription, text): Types the given text into the first element matching a natural language description of where you want to type. For example "username input".
- findAndSelect(elementDescription): Finds and selects elements based on a natural language description of the elements. For example "search results".
- findContent(elementDescription): Finds text content based on a natural language description of the content.  For example "selling price".
- promptUser(text): asked the user context or clarification.`;

const selectionMode = `- navigate(url): Navigates to the given URL.
- findAndClick(elementDescription): Clicks on the first element matching a natural language description of the item you want to click. For example "shopping cart button".
- findAndType(elementDescription, text): Types the given text into the first element matching a natural language description of where you want to type. For example "username input".
- findAndSelect(elementDescription): Finds and selects elements based on a natural language description of the elements. For example "search results".
- findContent(elementDescription): Finds text content based on a natural language description of the content.  For example "selling price".
- promptUser(text): asked the user context or clarification.
- click(): click the selected element.
- type(text): type into the selected input.
- getText(): get the inner text of the selected element.`;

export default function prompt({ driver } = {}) {
  const elementSelected = driver ? !!driver.state().selectedElement : false;
  const functionDescriptions = elementSelected ? selectionMode : defaultFunctions;
  return `
    You are an AI assistant capable of controlling a web browser. Your task is to accomplish a given objective by calling the following functions:
    
    ${functionDescriptions}
    
    You can use these methods to automate web browsing tasks. For example, you could navigate to a website, enter text into a search input, click a button, and retrieve the results.
    
    For each step, provide your thought process behind the action you're taking and the function you're calling. Explain how the action contributes to achieving the overall objective.
    
    If you need additional context or clarification from the user, you can ask follow-up questions
    `;
}
