ALTER TABLE org_profiles ADD COLUMN locale text NOT NULL DEFAULT 'en-IN'
 CHECK(locale IN('en-IN','en-GB','en-US'));
ALTER TABLE org_profiles ADD COLUMN date_format text NOT NULL DEFAULT 'DD MMM YYYY'
 CHECK(date_format IN('DD MMM YYYY','DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'));
