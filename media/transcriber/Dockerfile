# The LMS classroom's transcriber (job sheet D41, phase B). See transcriber.py.
FROM python:3.12-slim

# Whisper's model is downloaded on the first class into /models, a volume, so
# it is fetched once rather than with every rebuild.
ENV HF_HOME=/models PYTHONUNBUFFERED=1

# PyAV held at 18: version 19 (September 2026) dropped an option faster-whisper
# 1.2.1 passes when it opens a file, and every transcription then fails with
# "unexpected keyword argument 'metadata_errors'". Found trying it, 26 October.
RUN pip install --no-cache-dir faster-whisper==1.2.1 av==18.1.0

WORKDIR /app
COPY transcriber.py .

EXPOSE 8790
CMD ["python", "transcriber.py"]
