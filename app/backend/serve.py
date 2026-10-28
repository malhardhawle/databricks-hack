"""Entry point for Databricks Apps: serve on the port the platform assigns (DATABRICKS_APP_PORT, default 8000)."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("DATABRICKS_APP_PORT", "8000")))
