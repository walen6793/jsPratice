const axios = require('axios');

async function getZoomAccessToken(){
    const {ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET} = process.env;

    const buffer = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
    try{
        const response = await axios.post(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`, null ,
            {
                headers: {
                    'Authorization': `Basic ${buffer}`,
                    'Content-Type' : 'application/x-www-form-urlencoded'
                    
                }
                
            }
        );
        console.log("ได้ Token แล้ว!");
        return response.data.access_token;

    }catch(error){
        console.error("ขอ Token ไม่สำเร็จ:", error.response ? error.response.data : error.message);
        throw error;
    }

}

async function createMeeting(topic,start_time,duration){
    try{
        const token = await getZoomAccessToken();
        console.log("กำลังสั่ง Zoom สร้างห้องประชุม...")

        const response = await axios.post('https://api.zoom.us/v2/users/me/meetings',{
            topic: topic,
            type : 2,
            start_time : start_time,
            duration: duration,
            timezone : "Asia/Bangkok",
            settings: {
                host_video: true,
                participant_video:true,
                join_before_host:false,
                waiting_room:true
            }
        },{
            headers:{
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );
        console.log("สร้างห้องสำเร็จ! นี่คือข้อข้อมูลห้องของคุณ :");
        const data = {
            topic : response.data.topic,
            join_url : response.data.join_url,
            start_url : response.data.start_url,
            password : response.data.password,
            meeting_id : response.data.id

        };
        return data;

    }catch(error){
        console.error("สร้างห้องไม่สำเร็จ:", error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { createMeeting };