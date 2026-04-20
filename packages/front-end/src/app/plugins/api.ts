import { defineNuxtPlugin } from '#app';
import FileModule from '@FE/repository/modules/file';
import InfraModules from '@FE/repository/modules/infra';
import LabsModule from '@FE/repository/modules/labs';
import OmicsRunsModule from '@FE/repository/modules/omics-runs';
import OmicsWorkflowsModule from '@FE/repository/modules/omics-workflows';
import OrgsModule from '@FE/repository/modules/orgs';
import SeqeraPipelinesModule from '@FE/repository/modules/seqera-pipelines';
import SeqeraRunsModules from '@FE/repository/modules/seqera-runs';
import UploadsModule from '@FE/repository/modules/uploads';
import UsersModule from '@FE/repository/modules/users';
import WorkflowAccessModule from '@FE/repository/modules/workflow-access';

interface IApiInstance {
  file: FileModule;
  infra: InfraModules;
  labs: LabsModule;
  orgs: OrgsModule;
  seqeraPipelines: SeqeraPipelinesModule;
  seqeraRuns: SeqeraRunsModules;
  omicsWorkflows: OmicsWorkflowsModule;
  omicsRuns: OmicsRunsModule;
  uploads: UploadsModule;
  users: UsersModule;
  workflowAccess: WorkflowAccessModule;
}

interface FetchOptions {
  baseURL: string;
}

const createFetchOptions = (nuxtApp): FetchOptions => ({
  baseURL: nuxtApp.$config.public.BASE_API_URL,
});

const createApiInstance = (apiFetcher: any): IApiInstance => ({
  file: new FileModule(apiFetcher),
  infra: new InfraModules(apiFetcher),
  labs: new LabsModule(apiFetcher),
  orgs: new OrgsModule(apiFetcher),
  seqeraPipelines: new SeqeraPipelinesModule(apiFetcher),
  seqeraRuns: new SeqeraRunsModules(apiFetcher),
  omicsWorkflows: new OmicsWorkflowsModule(apiFetcher),
  omicsRuns: new OmicsRunsModule(apiFetcher),
  uploads: new UploadsModule(apiFetcher),
  users: new UsersModule(apiFetcher),
  workflowAccess: new WorkflowAccessModule(apiFetcher),
});

export default defineNuxtPlugin((nuxtApp) => {
  const fetchOptions: FetchOptions = createFetchOptions(nuxtApp);
  const apiFetcher = $fetch.create(fetchOptions);
  const modules: IApiInstance = createApiInstance(apiFetcher);

  return {
    provide: {
      api: modules,
    },
  };
});
