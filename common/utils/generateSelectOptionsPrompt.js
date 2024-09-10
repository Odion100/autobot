export function generateSelectOptionsPrompt(options) {
  const formatOptionsForPrompt = (options) => {
    return options
      .map(
        (option, index) =>
          `Option Index ${index}: ${option.text} (value: "${option.value}")`
      )
      .join("\n");
  };

  const formattedOptions = formatOptionsForPrompt(options);
  return `You have clicked on a select element. You can choose from the following options if any aligns with the completion of your current objective:

${formattedOptions}

If none of these options align with your objective, you may choose not to select any option.`;
}
