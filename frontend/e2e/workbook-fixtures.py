import json
import sys

from openpyxl import Workbook


output_path, payload_json = sys.argv[1:]
payload = json.loads(payload_json)
workbook = Workbook()
worksheet = workbook.active
worksheet.append(payload["headers"])
for row in payload["rows"]:
    worksheet.append(row)
workbook.save(output_path)
workbook.close()
