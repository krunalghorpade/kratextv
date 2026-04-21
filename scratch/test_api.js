async function testApi() {
    const videoId = '3N5D02qAo0o'; // Example video
    try {
        const response = await fetch(`https://yt.lemnoslife.com/noKey/videos?part=snippet&id=${videoId}`);
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch(err) {
        console.error("API Error:", err);
    }
}
testApi();
