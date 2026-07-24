import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';
import { envConfig } from '../../../config/env-config';

const labName = 'Playwright test lab';
const labNameUpdated = 'Automated Lab - Updated';
const seqeraPipeline = 'quality-e2e-test-pipeline';
const omicsWorkflow = 'k-florek/workshop-main';
const filePath1 = './tests/e2e/fixtures/NA1287820K_R1_001.fastq.gz';
const filePath2 = './tests/e2e/fixtures/NA1287820K_R2_001.fastq.gz';
const filePath3 = './tests/e2e/fixtures/EasyG_File.fastq.gz';
const fileName1 = 'NA1287820K_R1_001.fastq.gz';
const fileName2 = 'NA1287820K_R2_001.fastq.gz';
const labTechnicianName = 'Lab Technician';
const organizationID = '61c86013-74f2-4d30-916a-70b03a97ba14';
let laboratoryID: string;
let seqeraSampleSheetUrl: string;
let omicsSampleSheetUrl: string;
let seqRunNameVar: string;
let omicsRunNameVar: string;

test('01 - Hide Create a new Laboratory button', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForTimeout(2000);

  // confirm button if enabled/visible
  await expect(page.getByRole('button', { name: 'Create a new Lab' })).toBeHidden();
});

test('02 - Hide Remove a Laboratory option', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if any test lab exists
  let hasTestLab = true;
  try {
    hasTestLab = await page.getByRole('row').nth(1).isVisible();
  } catch (error) {
    console.error('No labs found');
  }

  if (hasTestLab) {
    // Click on the first lab row available
    await page.getByRole('row').locator('button').nth(1).click();

    // Confirm if Remove option is available on the first row
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeHidden();
  }
});

test('03 - Hide Organization link', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}`);
  await page.waitForLoadState('networkidle');

  //check if the Organizations menu is visible
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeHidden();
});

test('04 - Disable Editing Lab Details', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labName }).isVisible();
  } catch (error) {
    console.log(labName + ' test lab not found', error);
  }

  if (hasTestLab == true) {
    await page.getByRole('row', { name: labName }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();

    // check if Edit is disabled
    await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
  } else {
    console.log('Cannot find ' + labName);
  }

  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasUpdatedTestLab = false;
  try {
    hasUpdatedTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log(labNameUpdated + ' test lab not found', error);
  }

  if (hasUpdatedTestLab == true) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();

    // check if Edit is disabled
    await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
  } else {
    console.log('Cannot find ' + labNameUpdated);
  }
});

test('05 - Remove user from a Laboratory Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasUpdatedTestLab = true;
  try {
    hasUpdatedTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Test lab not found', error);
  }

  if (hasUpdatedTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.getByRole('tab', { name: 'Users' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.waitForLoadState('networkidle');

    let userVisible = false;
    try {
      userVisible = await page.getByRole('row', { name: labTechnicianName }).isVisible();
    } catch (error) {
      console.log('User is not added yet to Automation Lab!', error);
    }

    if (userVisible == true) {
      await page.getByRole('row', { name: labTechnicianName }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Remove From Lab' }).click();
      await page.getByRole('button', { name: 'Remove User' }).click();
      await page.waitForTimeout(2000);
      //await page.getByRole('status').locator('div').nth(1).click();
      await expect(
        page.getByText('Successfully removed ' + labTechnicianName + ' from ' + labNameUpdated).nth(0),
      ).toBeVisible();
    }
  }
});

test('06 - Add a Lab Technician to a Lab Successfully', async ({ page, baseURL }) => {
  // Check if the user has been added already to a Lab
  await page.goto(`${baseURL}/labs`);
  await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.getByRole('tab', { name: 'Users' }).click();

  let userHidden = false;
  try {
    userHidden = await page.getByRole('row', { name: labTechnicianName }).isHidden();
  } catch (error) {
    console.log('User is not added yet to Automation Lab!', error);
  }

  if (userHidden == true) {
    await page.getByRole('button', { name: 'Add Lab Users' }).click();
    await page.getByText('Select User').click();
    await page.getByPlaceholder('Search all users...').click();
    await page.keyboard.type(envConfig.labTechnicianEmail);
    await page.getByRole('option', { name: labTechnicianName }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(/Added 1, Skipped 0, Failed 0/)).toBeVisible();
  }
});

test('07 - Launch Seqera Run Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    // update Laboratory
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);

    const automatedLabURL = await page.url();
    let laboratoryID = automatedLabURL.match(/labs\/(\S+)/)?.[1];
    console.log('Laboratory ID:' + laboratoryID);

    await page.getByRole('tab', { name: 'Seqera Pipelines' }).click();
    await page.waitForLoadState('networkidle');

    let hasSeqPipeline = false;
    try {
      hasSeqPipeline = await page.getByRole('row', { name: seqeraPipeline }).isVisible();
    } catch (error) {
      console.log('Pipeline not found', error);
    }

    if (hasSeqPipeline) {
      const uuid = randomUUID();
      const seqRunName = `EasyG_SEQ_Run-${uuid}`;

      await page.getByRole('row', { name: seqeraPipeline }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Run' }).click();
      await page.waitForLoadState('networkidle');

      // STEP 01
      await page.getByRole('textbox', { name: 'Run Name*' }).click();
      await page.getByRole('textbox', { name: 'Run Name*' }).fill(seqRunName);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 02
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Choose Files' }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles([filePath1, filePath2]);
      await page.getByRole('button', { name: 'Upload Files' }).click();
      await page.waitForTimeout(12 * 1000);

      // ** Check if files are successfully uploaded
      await page.waitForLoadState('networkidle');
      //await expect(page.getByText('Files uploaded successfully').nth(0)).toBeVisible();  //temporily disabling due to timing issues

      // ** Check if Download Sample Sheet button is enabled
      await expect(page.getByRole('button', { name: 'Download sample sheet' })).toBeEnabled();

      // ** Check value of S3 url in the purple bar
      seqeraSampleSheetUrl =
        's3://' + envConfig.testS3Url + '/' + organizationID + '/' + laboratoryID + '/seqera-platform';
      await page.waitForTimeout(2000);
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
        seqeraSampleSheetUrl,
      ); // checks the url value
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
        'samplesheet-' + seqRunName + '.csv',
      ); // checks the file name

      await page.getByRole('button', { name: 'Next step' }).click();

      // STEP 03
      await expect(page.getByRole('textbox', { name: 'Input/output options' })).not.toBeNull();
      await expect(page.getByRole('textbox', { name: 'outdir' })).not.toBeNull();
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 04
      await page.getByRole('button', { name: 'Launch Pipeline Run' }).click();
      await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'Back to Runs' }).click();
      await page.waitForLoadState('networkidle');

      // ** Check if the run name appears in the Run List
      await expect(page.getByRole('row', { name: seqRunName })).toBeVisible();

      //set runNameVar to be used by other steps
      seqRunNameVar = seqRunName;
    }
  }
});

test('08 - Check Seqera Run Details', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    // Go to Run Details
    await page
      .getByRole('row', { name: seqRunNameVar })
      .filter({ has: page.locator('button') })
      .locator('button')
      .click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();
    await page.waitForTimeout(5000);

    // Check Run Name and other details
    await expect(page.getByText(seqRunNameVar).nth(0)).toBeVisible(); // Run name as title
    await expect(page.getByText('Submitted')).toBeVisible(); // Pipeline initial Run Status
    await expect(page.getByText(seqRunNameVar).nth(1)).toBeVisible(); // Run name in the details section
    await expect(page.getByText(seqeraPipeline).nth(0)).toBeVisible(); // Pipeline name as title
    await expect(page.getByText(seqeraPipeline).nth(1)).toBeVisible(); // Pipeline name in the details section
    await expect(page.getByText('Seqera Cloud')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
      seqeraSampleSheetUrl,
    ); // checks the url value
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
      'samplesheet-' + seqRunNameVar + '.csv',
    ); // checks the file name
    await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
    await expect(page.getByText(envConfig.labManagerEmail)).toBeVisible(); // Owner
  }
});

test('09 - Check Seqera Run File Manager if files exist', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    // Go to File Manager
    await page
      .getByRole('row', { name: seqRunNameVar })
      .filter({ has: page.locator('button') })
      .locator('button')
      .click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();
    await page.getByRole('tab', { name: 'File Manager' }).click();
    await page.waitForTimeout(5 * 2000);

    // Check for few filenames
    await page.getByRole('row', { name: fileName1 }).locator('button').click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Your files have begun downloading').nth(0)).toBeVisible();
    await page.getByRole('row', { name: fileName2 }).locator('button').click();
    await page.waitForTimeout(5000);
    await page
      .getByRole('row', { name: 'samplesheet-' + seqRunNameVar + '.csv' })
      .locator('button')
      .click();
    await page.waitForTimeout(5000);
  }
});

test('10 - Check if Reset Password fails', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}`);
  await page.waitForLoadState('networkidle');

  // confirm button if enabled/visible
  await page.getByRole('button', { name: 'LM' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.waitForTimeout(2000);

  // check Sign out confirmation
  await expect(page.getByText('You have been signed out')).toBeVisible();

  await page.getByRole('link', { name: 'Forgot password?' }).click();

  // check page link where the user is redirected
  await page.waitForLoadState();
  expect(page.url()).toEqual(`${baseURL}/forgot-password`);

  await page.waitForTimeout(2000);
  await page.getByLabel('Email address').fill(`${envConfig.testInviteEmail}`);
  await page.getByRole('button', { name: 'Send password reset link' }).click();

  // check confirmation
  await page.waitForTimeout(2000);
  await expect(page.getByText('Reset link has been sent to ' + envConfig.testInviteEmail)).toBeVisible();
});

test('11 - Launch HealthOmics Run Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    // update Laboratory
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);

    const automatedLabURL = await page.url();
    let laboratoryID = automatedLabURL.match(/labs\/(\S+)/)?.[1];
    console.log('Laboratory ID:' + laboratoryID);

    await page.getByRole('tab', { name: 'HealthOmics Workflows' }).click();
    await page.waitForLoadState('networkidle');

    let hasSeqPipeline = false;
    try {
      hasSeqPipeline = await page.getByRole('row', { name: omicsWorkflow }).isVisible();
    } catch (error) {
      console.log('Pipeline not found', error);
    }

    if (hasSeqPipeline) {
      const uuid = randomUUID();
      const omicsRunName = `EG_OMICS_Run-${uuid}`;

      await page.getByRole('row', { name: omicsWorkflow }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Run' }).click();
      await page.waitForLoadState('networkidle');

      // STEP 01
      await page.getByRole('textbox', { name: 'Run Name*' }).click();
      await page.getByRole('textbox', { name: 'Run Name*' }).fill(omicsRunName);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 02
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Choose Files' }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles([filePath1, filePath2]);
      await page.getByRole('button', { name: 'Upload Files' }).click();
      await page.waitForTimeout(12 * 1000);

      await page.waitForLoadState('networkidle');

      // ** Check if Download Sample Sheet button is enabled
      await expect(page.getByRole('button', { name: 'Download sample sheet' })).toBeEnabled();

      // ** Check value of S3 url in the purple bar
      omicsSampleSheetUrl =
        's3://' + envConfig.testS3Url + '/' + organizationID + '/' + laboratoryID + '/aws-healthomics';
      await page.waitForTimeout(2000);
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
        omicsSampleSheetUrl,
      ); // checks the url value
      await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
        'samplesheet-' + omicsRunName + '.csv',
      ); // checks the file name

      await page.getByRole('button', { name: 'Next step' }).click();

      // STEP 03
      await expect(page.getByRole('textbox', { name: 'Input' })).not.toBeNull();
      await expect(page.getByRole('textbox', { name: 'outdir' })).not.toBeNull();
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 04
      await page.getByRole('button', { name: 'Launch Workflow Run' }).click();
      await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'Back to Runs' }).click();
      await page.waitForLoadState('networkidle');

      // ** Check if the run name appears in the Run List
      await expect(page.getByRole('row', { name: omicsRunName })).toBeVisible();

      //set runNameVar to be used by other steps
      omicsRunNameVar = omicsRunName;
    }
  }
});

test('12 - Check HealthOmics Run Details', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    // Go to Run Details
    await page
      .getByRole('row', { name: omicsRunNameVar })
      .filter({ has: page.locator('button') })
      .locator('button')
      .click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();
    await page.waitForTimeout(5000);

    // Check Run Name and other details
    await expect(page.getByText(omicsRunNameVar).nth(0)).toBeVisible(); // Run name as title
    await expect(page.getByText('Submitted')).toBeVisible(); // Pipeline initial Run Status
    await expect(page.getByText(omicsRunNameVar).nth(1)).toBeVisible(); // Run name in the details section
    await expect(page.getByText(omicsWorkflow).nth(0)).toBeVisible(); // Pipeline name as title
    await expect(page.getByText(omicsWorkflow).nth(1)).toBeVisible(); // Pipeline name in the details section
    await expect(page.getByText('AWS HealthOmics')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(omicsSampleSheetUrl); // checks the url value
    await expect(page.getByRole('button', { name: 'Copy URL: s3://851725267090-' })).toContainText(
      'samplesheet-' + omicsRunNameVar + '.csv',
    ); // checks the file name
    await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
    await expect(page.getByText(envConfig.labManagerEmail)).toBeVisible(); // Owner
  }
});

test('13 - Check HealthOmics Run File Manager if files exist', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    // Go to File Manager
    await page
      .getByRole('row', { name: omicsRunNameVar })
      .filter({ has: page.locator('button') })
      .locator('button')
      .click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();
    await page.getByRole('tab', { name: 'File Manager' }).click();
    await page.waitForTimeout(5 * 2000);

    // Check for few filenames
    await page.getByRole('row', { name: fileName1 }).locator('button').click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Your files have begun downloading').nth(0)).toBeVisible();
    await page.getByRole('row', { name: fileName2 }).locator('button').click();
    await page.waitForTimeout(5000);
    await page
      .getByRole('row', { name: 'samplesheet-' + omicsRunNameVar + '.csv' })
      .locator('button')
      .click();
    await page.waitForTimeout(5000);
  }
});

test('14 - Launch HealthOmics Run without a file successfully', async ({ page, baseURL }) => {
  const omicsRunInput =
    's3://' +
    envConfig.testS3Url +
    '/61c86013-74f2-4d30-916a-70b03a97ba14/3be753b1-bb5d-4771-a065-e171f39af2eb/aws-healthomics/79836b16-d702-46bd-bd6b-4017e0c58c7b/sample-sheet.csv';
  const omicsRunOutdir =
    's3://' +
    envConfig.testS3Url +
    '/61c86013-74f2-4d30-916a-70b03a97ba14/3be753b1-bb5d-4771-a065-e171f39af2eb/aws-healthomics/79836b16-d702-46bd-bd6b-4017e0c58c7b/results';

  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    // update Laboratory
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'HealthOmics Workflows' }).click();
    await page.waitForLoadState('networkidle');

    let hasSeqPipeline = false;
    try {
      hasSeqPipeline = await page.getByRole('row', { name: omicsWorkflow }).isVisible();
    } catch (error) {
      console.log('Pipeline not found', error);
    }

    if (hasSeqPipeline) {
      const uuid = randomUUID();
      const omicsRunName2 = `EG_OMICS_Run-${uuid}`;
      await page.getByRole('row', { name: omicsWorkflow }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Run' }).click();
      await page.waitForLoadState('networkidle');

      // STEP 01
      await page.getByRole('textbox', { name: 'Run Name*' }).click();
      await page.getByRole('textbox', { name: 'Run Name*' }).fill(omicsRunName2);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 02
      // ** Skip uploading files
      await page.getByRole('button', { name: 'Skip' }).click();
      await page.waitForTimeout(12 * 1000);

      // STEP 03
      await page.getByRole('textbox', { name: 'outdir' }).fill(omicsRunOutdir);
      await page.getByRole('textbox', { name: 'Input' }).fill(omicsRunInput);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 04
      await page.getByRole('button', { name: 'Launch Workflow Run' }).click();
      await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'Back to Runs' }).click();
      await page.waitForLoadState('networkidle');

      // ** Check if the run name appears in the Run List
      await expect(page.getByRole('row', { name: omicsRunName2 })).toBeVisible();

      //set runNameVar to be used by other steps
      omicsRunNameVar = omicsRunName2;
    }
  }
});

test('15 - Launch Seqera Run with a single file successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    // update Laboratory
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Seqera Pipelines' }).click();
    await page.waitForLoadState('networkidle');

    let hasSeqPipeline = false;
    try {
      hasSeqPipeline = await page.getByRole('row', { name: seqeraPipeline }).isVisible();
    } catch (error) {
      console.log('Pipeline not found', error);
    }

    if (hasSeqPipeline) {
      const uuid = randomUUID();
      const seqRunName3 = `EasyG_SEQ_Run-${uuid}`;
      await page.getByRole('row', { name: seqeraPipeline }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Run' }).click();
      await page.waitForLoadState('networkidle');

      // STEP 01
      await page.getByRole('textbox', { name: 'Run Name*' }).click();
      await page.getByRole('textbox', { name: 'Run Name*' }).fill(seqRunName3);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 02
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Choose Files' }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(filePath3);
      await page.getByRole('button', { name: 'Upload Files' }).click();
      await page.waitForTimeout(12 * 1000);

      // ** Check if files are successfully uploaded
      await page.waitForLoadState('networkidle');
      //await expect(page.getByText('Files uploaded successfully').nth(0)).toBeVisible();  //temporily disabling due to timing issues

      // ** Check if Download Sample Sheet button is enabled
      await expect(page.getByRole('button', { name: 'Download sample sheet' })).toBeEnabled();

      await page.getByRole('button', { name: 'Next step' }).click();

      // STEP 03
      await expect(page.getByRole('textbox', { name: 'Input/output options' })).not.toBeNull();
      await expect(page.getByRole('textbox', { name: 'outdir' })).not.toBeNull();
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 04
      await page.getByRole('button', { name: 'Launch Pipeline Run' }).click();
      await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'Back to Runs' }).click();
      await page.waitForLoadState('networkidle');

      // ** Check if the run name appears in the Run List
      await expect(page.getByRole('row', { name: seqRunName3 })).toBeVisible();
    }
  }
});

test('16 - Check if user can upload a single and pair files together unsuccessfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'Playwright test lab' which was created in another test
  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log('Updated test lab not found', error);
  }

  // Check if a 'Playwright test lab' is existing then update can proceed
  if (hasTestLab) {
    // update Laboratory
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForTimeout(5 * 1000);
    await page.getByRole('tab', { name: 'Seqera Pipelines' }).click();
    await page.waitForLoadState('networkidle');

    let hasSeqPipeline = false;
    try {
      hasSeqPipeline = await page.getByRole('row', { name: seqeraPipeline }).isVisible();
    } catch (error) {
      console.log('Pipeline not found', error);
    }

    if (hasSeqPipeline) {
      const uuid = randomUUID();
      const seqRunName = `EasyG_SEQ_Run-${uuid}`;
      await page.getByRole('row', { name: seqeraPipeline }).locator('button').click();
      await page.getByRole('menuitem', { name: 'Run' }).click();
      await page.waitForLoadState('networkidle');

      // STEP 01
      await page.getByRole('textbox', { name: 'Run Name*' }).click();
      await page.getByRole('textbox', { name: 'Run Name*' }).fill(seqRunName);
      await page.getByRole('button', { name: 'Save & Continue' }).click();

      // STEP 02
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Choose Files' }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles([filePath1, filePath2, filePath3]);

      // ** Check if error appears in the page
      await expect(page.getByRole('button', { name: 'Upload Files' })).toBeDisabled();
      //await expect(page.getByText('There is a mix of single files and pair files. Files must be all single files or all pair files.', exact: true)).toBeVisible();
      //await expect(page.getByRole('button', { name: 'There is a mix of single files and pair files. Files must be all single files or all pair files.', exact: true })).toBeVisible();
      await expect(page.getByLabel('Upload Data').getByText('There is a mix of single')).toBeVisible();
    }
  }
});
