import { AppModule } from '../src/app.module';
import { registeredHttpRoutes } from '../src/common/security/route-inventory';
process.stdout.write(JSON.stringify(registeredHttpRoutes(AppModule).map(route=>({
  ...route,guards:route.guards.map(guard=>guard.name),
})),null,2)+'\n');
