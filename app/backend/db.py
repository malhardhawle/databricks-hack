"""Lakebase (Postgres) connection pool using short-lived Databricks OAuth tokens.

In a Databricks App the database resource injects PGHOST / PGDATABASE / PGUSER and the app's
service-principal credentials. Locally, the CLI profile (DATABRICKS_CONFIG_PROFILE, default `hack`)
is used and the host is looked up from the instance.
"""
import os
import time
import uuid

import pandas as pd
import psycopg
from databricks.sdk import WorkspaceClient
from psycopg.types.numeric import FloatLoader
from psycopg_pool import ConnectionPool

psycopg.adapters.register_loader("numeric", FloatLoader)  # numeric -> float, so pandas math just works

if "DATABRICKS_CLIENT_ID" not in os.environ:  # not running as a Databricks App
    os.environ.setdefault("DATABRICKS_CONFIG_PROFILE", "hack")

INSTANCE = os.environ.get("LAKEBASE_INSTANCE", "cnrl-acq")
TOKEN_TTL_SECONDS = 30 * 60

_ws = WorkspaceClient()
_token = {"value": None, "issued": 0.0}


def _get_token():
    if time.time() - _token["issued"] > TOKEN_TTL_SECONDS:
        cred = _ws.database.generate_database_credential(request_id=str(uuid.uuid4()), instance_names=[INSTANCE])
        _token.update(value=cred.token, issued=time.time())
    return _token["value"]


class OAuthConnection(psycopg.Connection):
    @classmethod
    def connect(cls, conninfo="", **kwargs):
        kwargs["password"] = _get_token()
        return super().connect(conninfo, **kwargs)


def _conninfo():
    host = os.environ.get("PGHOST") or _ws.database.get_database_instance(INSTANCE).read_write_dns
    user = os.environ.get("PGUSER") or _ws.current_user.me().user_name
    return (f"host={host} port={os.environ.get('PGPORT', '5432')} "
            f"dbname={os.environ.get('PGDATABASE', 'acq')} user={user} "
            f"sslmode={os.environ.get('PGSSLMODE', 'require')}")


pool = ConnectionPool(_conninfo(), connection_class=OAuthConnection, min_size=1, max_size=5,
                      max_lifetime=TOKEN_TTL_SECONDS, open=True)


def query(sql, params=None):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or {})
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)
