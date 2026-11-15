-- Remove the compatibility policies 20261022120000_row_level_security_tenant_tables added for a
-- release that never set app.rls_version. They let any connection that did not claim version 2
-- read and write those tables across Spaces.
--
-- Safe beside the previous release, which runs for a few seconds after this applies: every
-- release since version 2 was introduced sets app.rls_version = 2 in the transaction of every
-- statement it sends through the application pool, so these policies never granted it anything.
-- The connections that do not set it (job queue, locks, realtime listener) touch only
-- graphile_worker tables and NOTIFY channels, not these tables. Dropping a policy is a metadata
-- change; the *_tenant and *_system policies the previous release uses are untouched.

DO $$
DECLARE
  protected text;
BEGIN
  FOREACH protected IN ARRAY ARRAY[
    'bots', 'runs', 'tasks', 'routines', 'connections', 'mcp_servers', 'mcp_oauth_sessions',
    'bot_mcp_servers', 'computers', 'boards', 'tickets', 'ticket_comments',
    'messaging_identities', 'external_conversations', 'usage_records', 'scratchpad_items',
    'action_approval_rules', 'messaging_outbound', 'external_messages', 'steering_messages',
    'security_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', protected || '_previous_release', protected);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS app_rls_version();
