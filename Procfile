web: cd backend && python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --proxy-headers --forwarded-allow-ips "*" --access-log --no-server-header
