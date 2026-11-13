CREATE TABLE notification_rate_budgets(
 org_id uuid NOT NULL REFERENCES organisations(id),channel text NOT NULL CHECK(channel IN('IN_APP','EMAIL','SMS','WHATSAPP')),
 window_start timestamptz NOT NULL,claimed integer NOT NULL CHECK(claimed BETWEEN 0 AND 100),PRIMARY KEY(org_id,channel,window_start)
);
ALTER TABLE notification_rate_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rate_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_rate_budget_tenant ON notification_rate_budgets USING(org_id=current_setting('app.current_org',true)::uuid)
 WITH CHECK(org_id=current_setting('app.current_org',true)::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON notification_rate_budgets TO tc_app;
