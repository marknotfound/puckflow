DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'puckflow_app') THEN
    CREATE ROLE puckflow_app LOGIN PASSWORD 'puckflow_local';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE puckflow TO puckflow_app;
GRANT USAGE ON SCHEMA public TO puckflow_app;
