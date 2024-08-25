export const executionReminder = `
<?xml version="1.0" encoding="UTF-8"?>
<execution-reminder>
  <introduction>As you continue, answer the following questions:</introduction>
  
  <question-set>
    <category>
      <name>Confirm Action</name>
      <questions>
        <question>Was the intended outcome achieved?</question>
        <question>Did I interact with the correct element?</question>
        <question>What visual or textual evidence confirms this?</question>
      </questions>
    </category>
    
    <category>
      <name>Plan Next Task</name>
      <questions>
        <question>Given the current state, what is the next logical step?</question>
      </questions>
    </category>
    
    <category>
      <name>Locate Target Element</name>
      <questions>
        <question>Is the target element visible in the current screenshot?</question>
        <sub-questions>
          <question>If not visible:</question>
          <bullet-points>
            <point>Should I scroll to find the element?</point>
            <point>Is the element in the Domain memory?</point>
          </bullet-points>
        </sub-questions>
      </questions>
    </category>
  </question-set>
  
  <element-selection-process>
    <title>Element Selection Process</title>
    <steps>
      <step>Collect specific, unique text and distinguishing information about the target element from the screenshot.</step>
      <step>Gather all container text to ensure the correct element and the correct container is selected.</step>
      <step>Use this detailed information to construct precise arguments for click and type functions.</step>
    </steps>
  </element-selection-process>
  
  <important-reminders>
    <reminder>Use the promptUser function if you need more context or if you have finished all tasks.</reminder>
    <reminder>SCROLL TO FIND THE ITEM YOU WANT TO click or type into if it's not in the current screenshot.</reminder>
  </important-reminders>
</execution-reminder>
`;
export const searchHelpMessage = `Please revise your search terms for selecting the container and element you want to interact with by following these steps:

1. Examine the screenshot to identify the target element.
2. Double check to make sure that the target element is actually in the screenshot.
- If the target element is not in the screen shot scroll to find it.
3. CRITICAL: DO NOT MAKE ASSUMPTIONS ABOUT THE ELEMENTS, CONTAINERS, AND TEXT OUTSIDE OF THE CURRENT SCREENSHOT. IF THE ITEM YOU ARE LOOKING FOR IS NOT IN THE SCREENSHOT USE THE SCROLL FUNCTION TO FIND IT.
4. Provide a clear and concise elementName.
6. Specify the elementFunctionality to clarify the purpose or action of the element (e.g., 'Filters search results to show only items in new condition.').
7. Include the exact innerText of the element if applicable (e.g., 'New') as seen in the screenshot.
8. Revise the containerName for the container that actually holds the element based on the current screenshot.
9. Describe the containerFunctionality to provide context for the element's location and purpose.
10. Gather more exact containerText to help locate the correct red-bordered container, focusing on key identifiable text within the container.

Remember to be as specific and accurate as possible in your descriptions to ensure the correct element and container are identified.`;
