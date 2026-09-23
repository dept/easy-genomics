// Returns a string conforming to the requirements for entities e.g. Organization name
export function cleanText(input: string, maxLength: number | undefined) {
  let cleanedText = removeUnsupportedCharacters(input);
  cleanedText = singleSpace(cleanedText);
  cleanedText = firstCharAlphanumeric(cleanedText);
  cleanedText = maxLengthText(cleanedText, maxLength);
  return cleanedText;
}

/*
  Returns a string containing only alphanumeric characters,
  hyphen, comma, apostrophe, period, underscore, space and parenthesis (-,'._ )
*/
export function removeUnsupportedCharacters(input: string) {
  return input.replace(/[^a-zA-Z0-9-,'._ ()]/g, '');
}

// Returns a string with only one space between words
export function singleSpace(input: string) {
  return input.replace(/\s+/g, ' ');
}

// Returns a string with no leading special characters
export function firstCharAlphanumeric(input: string) {
  const match = input.match(/[a-zA-Z0-9]/);
  if (match) {
    const index = match.index;
    return input.substring(index);
  }
  return '';
}

/*
  Returns a string containing the first N-characters of the input string,
  where N is the maximum number of characters allowed.
  If maxLength is undefined, returns the original string.
  If the input string is shorter than maxLength, returns the original string.
*/
export function maxLengthText(input: string, maxLength: number | undefined) {
  if (maxLength) {
    return input.slice(0, maxLength);
  }
  return input;
}

export function getCharacterText(count: number) {
  return count === 1 ? 'character' : 'characters';
}

/**
 * Returns the value of a URL parameter
 *
 * @param {string} param
 * @return {*}  {(string | null)}
 */
export function getUrlParamValue(param: string): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * Capitalise the first letter, leaving the rest exactly as given.
 *
 * For text we did not author — LLM provider error messages arrive in whatever
 * case the provider chose. Only the first character is touched, so acronyms,
 * model IDs and quoted values survive intact.
 */
export function toSentenceCase(input: string | undefined): string | undefined {
  if (!input) return input;
  return input.charAt(0).toUpperCase() + input.slice(1);
}
