"""Public staging GET fallback; no authentication, storage, or data access."""

def lambda_handler(event, context):
    return {
        "statusCode": 404,
        "headers": {
            "Content-Type": "application/json",
            "Strict-Transport-Security": "max-age=31536000",
            "Cache-Control": "no-store",
        },
        "body": '{"message":"Not Found"}',
    }
