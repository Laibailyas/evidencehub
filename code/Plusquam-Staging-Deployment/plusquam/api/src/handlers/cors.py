"""CORS preflight handler.

Wired to `OPTIONS /{proxy+}` so every preflight request gets a 204 + CORS headers,
regardless of which actual route the browser is probing.
"""

from lib.http import preflight


def lambda_handler(event, _context):
    return preflight(event)
