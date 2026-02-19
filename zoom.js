require('dotenv').config();
const axios = require('axios');

const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

// 1. ฟังก์ชันขอ Token จาก Zoom
async function getZoomAccessToken() {
    console.log("กำลังขอ Access Token...");
    const buffer = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
            null,
            {
                headers: {
                    'Authorization': `Basic ${buffer}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        console.log("✅ ได้ Token แล้ว!");
        return response.data.access_token;
    } catch (error) {
        console.error("❌ ขอ Token ไม่สำเร็จ:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// 2. ฟังก์ชันสั่งสร้างห้อง
async function createMeeting() {
    try {
        const token = await getZoomAccessToken();
        console.log("กำลังสั่ง Zoom สร้างห้องประชุม...");

        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: "ทดสอบระบบเยี่ยมญาติ (จอ 1)",
                type: 2, // 2 = Scheduled Meeting
                start_time: "2026-03-01T09:00:00Z", // เวลาที่ต้องการให้เริ่ม
                duration: 30, // ระยะเวลา (นาที)
                timezone: "Asia/Bangkok",
                settings: {
                    host_video: true,
                    participant_video: true,
                    join_before_host: false,
                    waiting_room: true
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log("🎉 สร้างห้องสำเร็จ! นี่คือข้อมูลห้องของคุณ:");
        console.log("--------------------------------------------------");
        console.log("Topic:", response.data.topic);
        console.log("Join URL (ให้ญาติกด):", response.data.join_url);
        console.log("Start URL (ให้แอดมินกด):", response.data.start_url);
        console.log("Password:", response.data.password);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("❌ สร้างห้องไม่สำเร็จ:", error.response ? error.response.data : error.message);
    }
}

// สั่งรันฟังก์ชัน
createMeeting();