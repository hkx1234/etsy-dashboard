from datetime import datetime
from typing import Dict
from urllib.parse import urlparse
import boto3
from botocore.exceptions import ClientError
import os
import mimetypes
from pydantic import BaseModel
from ..core.config import settings
from app.exceptions.http_exceptions import APIException
import bleach
import time


class FileContent(BaseModel):
    filename: str
    content: str
    s3_url: str


class S3Handler:
    def __init__(self, bucket_name: str):
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION
        )
        self.bucket_name = bucket_name

    async def upload_file(self, file_path: str, original_filename: str) -> str:
        """Upload file to S3 and return URL"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            s3_key = f"uploads/{timestamp}_{original_filename}"

            content_type = mimetypes.guess_type(original_filename)[0]
            self.s3_client.upload_file(
                file_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={'ContentType': content_type}
            )

            if settings.AWS_ENDPOINT:
                s3_url = f"{settings.AWS_ENDPOINT}/{s3_key}"
            else:
                if settings.AWS_REGION and settings.AWS_REGION.startswith('cn-'):
                    s3_url = f"https://{self.bucket_name}.s3.{settings.AWS_REGION}.amazonaws.com.cn/{s3_key}"
                else:
                    s3_url = f"https://{self.bucket_name}.s3.{settings.AWS_REGION}.amazonaws.com/{s3_key}"

            return s3_url
        except ClientError as e:
            raise APIException(
                status_code=500,
                message=f"Failed to upload file to S3: {str(e)}"
            )


def sanitize_html(html_content):
    """Clean HTML content, allow only safe tags"""
    allowed_tags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u',
                    'ul', 'ol', 'li', 'span', 'a', 'img', 'blockquote', 'code', 'pre',
                    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div']
    allowed_attrs = {
        '*': ['class', 'style'],
        'a': ['href', 'rel', 'target'],
        'img': ['src', 'alt', 'width', 'height'],
        'table': ['border', 'cellpadding', 'cellspacing'],
        'th': ['colspan', 'rowspan'],
        'td': ['colspan', 'rowspan'],
    }
    return bleach.clean(html_content, tags=allowed_tags, attributes=allowed_attrs, strip=True)


def configure_http_proxy():
    """Configure HTTP proxy for development environment"""
    import os as _os
    import httpx

    if settings.ENV == "development" and settings.USE_HTTP_PROXY:
        _os.environ["HTTP_PROXY"] = settings.HTTP_PROXY
        _os.environ["HTTPS_PROXY"] = settings.HTTPS_PROXY
        return httpx.Client(proxy=settings.HTTP_PROXY)
    else:
        for key in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]:
            if key in _os.environ:
                del _os.environ[key]
    return httpx.Client(timeout=60.0)


def convert_to_timestamp(date_value):
    """Convert date to Unix timestamp"""
    if date_value is None:
        return None
    try:
        if isinstance(date_value, str):
            for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"]:
                try:
                    date_obj = datetime.strptime(date_value, fmt)
                    return int(time.mktime(date_obj.timetuple()))
                except ValueError:
                    continue
        elif isinstance(date_value, datetime):
            return int(time.mktime(date_value.timetuple()))
        return None
    except:
        return None
