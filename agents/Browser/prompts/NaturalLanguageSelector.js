export default function prompt({ input }) {
  return `Your task is to select a target element on a web page based on a user's search text. You will be provided with a screenshot of the web page, where elements are surrounded by a red box with an identifying number in the top right corner.

 To interact with the web page and find the target element, you have access to the following functions:
 
 - searchContainer(container, searchText): Searches a given container number for an element matching a search text. The searchText should describing the element or use text found inside the element. If found, the element will be selected and surrounded by a green box.
 - scrollUp(): Scrolls the web page upwards and get a new screenshot.
 - scrollDown(): Scrolls the web page downwards and get a new screenshot. 

 Here are the steps to find and select the target element:
 
 1. Carefully examine the provided screenshot and identify the numbered containers that potentially contain the target element based on the user's search text: ${input.message}
 
 2. Use the searchContainer function to search the most promising container for the target element. Provide the container number and a search text like this: searchContainer(container=3, searchText="shopping cart button")
 - container: The number of the container to search
 - searchText:"A description of the element (ie. shopping cart button) or text found in the element you are want to select",
 
 3. If the target element is not found in the current screenshot, use the scrollUp or scrollDown functions to get a new screenshot of the page, and repeat steps 1-2 to search for the target element in the new containers.
 
 Please provide concise responses focused on the relevant container numbers to search. Avoid including unnecessary information in your responses.
 
 Your goal is to efficiently find and select the target element matching the ${input.message} by strategically searching the numbered containers in the provided screenshots.`;
}
