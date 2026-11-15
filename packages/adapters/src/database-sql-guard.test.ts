import { describe, expect, it } from "vitest";
import { checkReadOnlySql } from "./database-sql-guard.js";

const allowed = [
  "select 1",
  "SELECT * FROM orders WHERE total > 10 ORDER BY id LIMIT 5;",
  "select count(*) filter (where paid) from invoices group by customer_id",
  "with recent as (select * from orders) select * from recent",
  "select a from t1 union all select a from t2",
  "values (1), (2)",
  "select * from generate_series(1, 10)",
  "select current_setting('server_version')",
  "/* report */ select 1 -- why",
  "explain select * from orders",
  "EXPLAIN (FORMAT JSON, VERBOSE) select * from orders",
  "explain verbose select 1",
  "select 'a;b' as semi",
];

const refused: Array<[string, string]> = [
  ["", "empty"],
  ["insert into t values (1)", "insert"],
  ["update t set a = 1", "update"],
  ["delete from t", "delete"],
  ["drop table t", "drop"],
  ["truncate t", "truncate"],
  ["create table t (a int)", "create"],
  ["alter table t add column b int", "alter"],
  ["copy t to '/tmp/x'", "copy"],
  ["set role admin", "set"],
  ["show all", "show"],
  ["begin", "begin"],
  ["commit", "commit"],
  ["do $$ begin perform 1; end $$", "do block"],
  ["select 1; select 2", "two statements"],
  ["select 1; drop table t", "statement after select"],
  ["select 1; /* hidden */ delete from t", "comment hides the second"],
  ["select 1 -- \n; delete from t", "line comment then a statement"],
  ["with d as (delete from t returning *) select * from d", "data-modifying CTE delete"],
  ["with i as (insert into t values (1) returning *) select * from i", "data-modifying CTE insert"],
  ["with u as (update t set a = 1 returning *) select * from u", "data-modifying CTE update"],
  ["select * from t for update", "row lock"],
  ["select * from t for share", "row lock share"],
  ["select 1 into newtable", "select into"],
  ["explain analyze select 1", "explain analyze"],
  ["explain (analyze) select 1", "explain option analyze"],
  ["explain (analyze true, verbose) select 1", "explain option analyze true"],
  ["explain analyze delete from t", "explain analyze delete"],
  ["explain delete from t", "explain of a write"],
  ["/* c */ explain analyze select 1", "comment before explain analyze"],
  ["select pg_sleep(30)", "pg_sleep"],
  ["select pg_catalog.pg_sleep(1)", "schema-qualified pg_sleep"],
  ['select "pg_sleep"(1)', "quoted pg_sleep"],
  ["select pg_sleep_for('1 minute')", "pg_sleep_for"],
  ["select pg_read_file('/etc/passwd')", "pg_read_file"],
  ["select pg_read_binary_file('/etc/passwd')", "pg_read_binary_file"],
  ["select * from pg_ls_dir('/')", "pg_ls_dir in from"],
  ["select pg_stat_file('/etc/passwd')", "pg_stat_file"],
  ["select lo_import('/etc/passwd')", "lo_import"],
  ["select lo_export(1, '/tmp/x')", "lo_export"],
  ["select * from dblink('host=x', 'select 1') as t(a int)", "dblink"],
  ["select dblink_exec('host=x', 'drop table t')", "dblink_exec"],
  ["select set_config('default_transaction_read_only', 'off', false)", "set_config"],
  ["select nextval('s')", "nextval"],
  ["select setval('s', 1)", "setval"],
  ["select pg_advisory_lock(1)", "advisory lock"],
  ["select pg_terminate_backend(1)", "terminate backend"],
  ["select pg_notify('c', 'x')", "notify"],
  ["select query_to_xml('delete from t', true, true, '')", "query_to_xml runs text as SQL"],
  ["select * from ts_stat('select 1')", "ts_stat runs text as SQL"],
  ["select 1 where 1 in (select pg_sleep(1))", "denied call in a subquery"],
  ["select x from t order by nextval('s')", "denied call in order by"],
  ["this is not sql", "garbage"],
  ["with recursive a as (select 1) select * from a", "not understood is refused"],
  ["select 1\u0000; drop table t", "nul byte"],
];

describe("checkReadOnlySql", () => {
  it.each(allowed)("allows %s", (sql) => {
    expect(checkReadOnlySql(sql)).toMatchObject({ ok: true });
  });

  it.each(refused)("refuses %s (%s)", (sql) => {
    expect(checkReadOnlySql(sql)).toMatchObject({ ok: false });
  });

  it("classifies EXPLAIN and strips the trailing semicolon", () => {
    expect(checkReadOnlySql("explain select 1;")).toEqual({
      ok: true,
      kind: "explain",
      sql: "explain select 1",
    });
    expect(checkReadOnlySql("select 1;;")).toMatchObject({
      ok: true,
      kind: "select",
      sql: "select 1",
    });
  });

  it("refuses an oversized statement", () => {
    expect(checkReadOnlySql(`select '${"a".repeat(25_000)}'`)).toMatchObject({ ok: false });
  });

  it("refuses a very deeply nested statement instead of overflowing the stack", () => {
    const deep = `${"select (".repeat(400)}1${")".repeat(400)}`;
    expect(checkReadOnlySql(deep)).toMatchObject({ ok: false });
  });
});
