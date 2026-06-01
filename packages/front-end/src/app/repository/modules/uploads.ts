import {
  FileUploadManifest,
  FileUploadRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-manifest';
import {
  SampleSheetRequest,
  SampleSheetResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-sample-sheet';
import HttpFactory from '@FE/repository/factory';

class UploadsModule extends HttpFactory {
  async getSampleSheetCsv(req: SampleSheetRequest, validate = false): Promise<SampleSheetResponse> {
    const query = validate ? '?validate=true' : '';
    const res = await this.call<SampleSheetResponse>('POST', `/upload/create-file-upload-sample-sheet${query}`, req);

    if (!res) {
      throw new Error('Failed to create file upload sample sheet');
    }

    return res;
  }

  async getFileUploadManifest(req: FileUploadRequest): Promise<FileUploadManifest> {
    const res = await this.call<FileUploadManifest>('POST', '/upload/create-file-upload-request', req);

    if (!res) {
      throw new Error('Failed to retrieve file upload manifest');
    }

    return res;
  }
}

export default UploadsModule;
