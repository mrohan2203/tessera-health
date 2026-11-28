-- The Privacy Sentinel reads the last 30 days of the audit log.
create index if not exists audit_log_ts on audit.log (ts);
