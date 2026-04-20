fetch("https://yt.lemnoslife.com/noKey/playlistItems?part=snippet&playlistId=PL9ExUjv_4xfHyE70ZC4BDxRR-X1upUjbh&maxResults=50")
.then(r => r.json())
.then(data => {
    if(data.items) {
        console.log("Success! Items:", data.items.length);
        console.log("First ID:", data.items[0].snippet.resourceId.videoId);
    } else {
        console.log("Failed", data);
    }
});
