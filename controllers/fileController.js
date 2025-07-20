const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// R2-compatible S3 client
const s3 = new S3Client({
  region: process.env.R2_REGION,
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

exports.generateUploadUrl = async (req, res) => {
  try {
    const { filename, filetype } = req.body;

    if (!filename || !filetype) {
      return res.status(400).json({ error: "Missing filename or filetype" });
    }

    const key = `uploads/${Date.now()}-${filename}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: filetype,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300, // 5 mins
    });

    const fileUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    res.status(200).json({ uploadUrl, fileUrl });
  } catch (err) {
    console.error("Failed to generate signed URL", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
