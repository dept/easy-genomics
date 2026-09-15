import { z } from 'zod';
import { getCharacterText } from '@FE/utils/string-utils';

/*
    Organization Name
    - Minimum of 1 character
    - Maximum of 50 characters
    - Accepts alphanumeric characters
    - Accepts UPPERCASE and lowercase characters
    - Does not accept special characters except for hyphen, comma, apostrophe, period, underscore, space and parenthesis (-,'._ )
    - Should not start with special character
    - If user leaves the field blank, an error message will be displayed in the page
    - User will not be able to type in additional characters if the maximum (50) was reached
    - Accepts value from copy and paste
    - If a user attempts to paste values above 50 characters, these characters will be filtered out and only the first 50 characters will be pasted
    - If a user attempts to paste invalid special characters, these characters will be filtered out and only the valid characters will be pasted
  */
export const ORG_NAME_MIN_LENGTH = 1;
export const ORG_NAME_MAX_LENGTH = 50;
/*
  Organization Description
  - Can be left blank
  - Maximum of 500 characters
  - Accepts alphanumeric characters
  - Accepts UPPERCASE and lowercase characters
  - Does not accept special characters except for hyphen, comma, apostrophe, period, underscore, space and parenthesis (-,'._ )
  - Should not start with special character
  - User will not be able to type in additional characters if the maximum (500) was reached
  - Accepts value from copy and paste
  - If a user attempts to paste values above 500 characters, these characters will be filtered out and only the first 500 characters will be pasted
  - If a user attempts to paste invalid special characters, these characters will be filtered out and only the valid characters will be pasted
*/
export const ORG_DESCRIPTION_MAX_LENGTH = 500;

export const OrgNameSchema = z
  .string()
  .min(ORG_NAME_MIN_LENGTH, {
    message: `Name must be at least ${ORG_NAME_MIN_LENGTH} ${getCharacterText(ORG_NAME_MIN_LENGTH)}`,
  })
  .max(ORG_NAME_MAX_LENGTH, { message: `${ORG_NAME_MAX_LENGTH} ${getCharacterText(ORG_NAME_MAX_LENGTH)} max` });

export const OrgDescriptionSchema = z
  .string()
  .min(0)
  .max(ORG_DESCRIPTION_MAX_LENGTH, {
    message: `${ORG_DESCRIPTION_MAX_LENGTH} ${getCharacterText(ORG_DESCRIPTION_MAX_LENGTH)} max`,
  });

export const OrgEmailBrandingLogoUrlSchema = z.string().url().optional().or(z.literal(''));

export const OrgDetailsFormSchema = z.object({
  Name: OrgNameSchema,
  Description: OrgDescriptionSchema,
  NextFlowTowerApiBaseUrl: z.string().min(0),
});
export type OrgDetailsForm = z.infer<typeof OrgDetailsFormSchema>;

export const OrgEmailBrandingFormSchema = z.object({
  EmailBrandingLogoUrl: OrgEmailBrandingLogoUrlSchema,
});
export type OrgEmailBrandingForm = z.infer<typeof OrgEmailBrandingFormSchema>;

const AutoCompleteOptions = {
  On: 'on',
  Off: 'off',
  CurrentPassword: 'current-password',
  NewPassword: 'new-password',
  FirstName: 'given-name',
  LastName: 'family-name',
} as const;
export const AutoCompleteOptionsEnum = z.nativeEnum(AutoCompleteOptions);
export type AutoCompleteOption = z.infer<typeof AutoCompleteOptionsEnum>;
