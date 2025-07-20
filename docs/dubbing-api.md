# 🎤 Dubbing API Documentation

All endpoints require authentication via `Authorization: Bearer <token>` header.

---

## 1. Create Dubbing

**POST** `/api/dubbing/`

Create a new dubbing record for the authenticated user.

### Request Body (JSON)

| Field           | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| audio_id        | string | Yes      | Unique audio file identifier               |
| status          | string | No       | One of: `processing`, `failed`, `complete` |
| project_title   | string | No       | Project title                              |
| source_language | string | No       | Source language code or name               |
| target_language | string | No       | Target language (default: `english`)       |
| speakers        | number | No       | Number of speakers                         |
| startTime       | number | No       | Start time in seconds                      |
| endTime         | number | No       | End time in seconds                        |

### Response

- `201 Created`

```json
{
  "message": "Dubbing saved successfully",
  "data": {
    /* dubbing object */
  }
}
```

#### Error Responses

- `400 Bad Request`
  - Missing required fields (e.g. `audio_id`)
- `404 Not Found`
  - User not authenticated
- `500 Internal Server Error`
  - Server error

---

## 2. Update Dubbing Status

**PUT** `/api/dubbing/status`

Update the status of a dubbing record.

### Request Body (JSON)

| Field     | Type   | Required                         | Description                                    |
| --------- | ------ | -------------------------------- | ---------------------------------------------- |
| audio_id  | string | Yes                              | Audio file identifier                          |
| status    | string | Yes                              | New status: `processing`, `failed`, `complete` |
| video_url | string | Required if status is `complete` | Video URL for completed dubbing                |

### Response

- `200 OK`

```json
{
  "message": "Status updated successfully",
  "data": {
    /* updated dubbing object */
  }
}
```

#### Error Responses

- `400 Bad Request`
  - Missing `audio_id` or `status`
  - Missing `video_url` when status is `complete`
- `404 Not Found`
  - User not authenticated
  - Dubbing not found
- `500 Internal Server Error`
  - Server error

---

## 3. Get Dubbing History

**GET** `/api/dubbing/history?page=1&limit=10`

Get paginated dubbing history for the authenticated user.

### Query Parameters

| Param | Type   | Required | Description                  |
| ----- | ------ | -------- | ---------------------------- |
| page  | number | No       | Page number (default: 1)     |
| limit | number | No       | Items per page (default: 10) |

### Response

- `200 OK`

```json
{
  "message": "Dubbing history fetched successfully",
  "data": [
    /* array of dubbing objects */
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

#### Error Responses

- `404 Not Found`
  - User not authenticated
- `500 Internal Server Error`
  - Server error

---

## 4. Delete Dubbing

**DELETE** `/api/dubbing/delete/:audio_id`

Delete a dubbing record for the authenticated user.

### URL Parameter

| Param    | Type   | Required | Description                  |
| -------- | ------ | -------- | ---------------------------- |
| audio_id | string | Yes      | Unique audio file identifier |

### Response

- `200 OK`

```json
{
  "message": "Dubbing deleted successfully"
}
```

#### Error Responses

- `404 Not Found`
  - User not authenticated
  - Record not found
- `500 Internal Server Error`
  - Server error

---

**Note:**  
All endpoints require authentication. Make sure to include a valid JWT token in the `Authorization` header.
