import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module';
import { WorkflowsModule } from '../src/modules/workflows/workflows.module';

describe('PH3-G21-003: obsolete workflow implementation is not part of the live API', () => {
  it('does not register simulation-only workflow providers in the application graph', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports).not.toContain(WorkflowsModule);
    expect(imports?.map((item: any) => item?.name)).toContain('WorkItemsModule');
    expect(imports?.map((item: any) => item?.name)).toContain('ReviewsModule');
    expect(imports?.map((item: any) => item?.name)).toContain('ChecklistsModule');
  });
});
