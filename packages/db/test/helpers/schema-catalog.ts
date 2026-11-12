import type { Pool } from 'pg';

export interface CatalogColumn {
  table_name: string;
  name: string;
  type: string;
  not_null: boolean;
  default_sql: string | null;
  generated: string;
  primary_key: boolean;
}

/** Read actual PostgreSQL definitions, never infer DDL from dated design files. */
export async function readColumns(pool: Pool): Promise<CatalogColumn[]> {
  return (await pool.query<CatalogColumn>(`
    SELECT c.relname AS table_name, a.attname AS name,
           format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
           pg_get_expr(d.adbin,d.adrelid) AS default_sql, a.attgenerated AS generated,
           EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid
             AND k.contype='p' AND a.attnum=ANY(k.conkey)) AS primary_key
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
     ORDER BY c.relname,a.attnum`)).rows;
}

/** SQL owns all DDL, including security and constraints not modeled by Drizzle. */
export async function readSchemaCatalog(pool: Pool) {
  return {
    columns: await readColumns(pool),
    relations: (await pool.query(`SELECT c.relname,c.relkind,c.relispartition,
      pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,
      pg_get_expr(c.relpartbound,c.oid) AS partition_bound
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S') ORDER BY c.relname`)).rows,
    constraints: (await pool.query(`SELECT c.relname,k.conname,k.contype,
      k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,k.conname`)).rows,
    indexes: (await pool.query(`SELECT c.relname,i.relname AS name,x.indisvalid,
      x.indisready,pg_get_indexdef(x.indexrelid) AS definition
      FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid
      JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,i.relname`)).rows,
    policies: (await pool.query(`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,
    grants: (await pool.query(`SELECT c.relname,CASE WHEN a.grantee=0 THEN 'PUBLIC'
      ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,
      a.privilege_type,a.is_grantable FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(
        CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S')
      ORDER BY c.relname,grantee,grantor,a.privilege_type`)).rows,
    triggers: (await pool.query(`SELECT c.relname,t.tgname,t.tgenabled,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`)).rows,
    functions: (await pool.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.prosrc,
      has_function_privilege('tc_app',p.oid,'EXECUTE') AS runtime_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      ORDER BY p.proname,arguments`)).rows,
    functionGrants: (await pool.query(`SELECT p.proname,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
      pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      ORDER BY p.proname,arguments,grantee,grantor,a.privilege_type`)).rows,
    schemaGrants: (await pool.query(`SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
      pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname='public' ORDER BY grantee,grantor,a.privilege_type`)).rows,
    defaultPrivileges: (await pool.query(`SELECT pg_get_userbyid(d.defaclrole) AS owner,
      n.nspname,d.defaclobjtype,CASE WHEN a.grantee=0 THEN 'PUBLIC'
        ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      ORDER BY owner,n.nspname,d.defaclobjtype,grantee,a.privilege_type`)).rows,
  };
}
