async function test() {
    const res = await fetch('https://yt.lemnoslife.com/noKey/playlistItems?part=snippet&playlistId=PL9ExUjv_4xfHyE70ZC4BDxRR-X1upUjbh&maxResults=50');
    const data = await res.json();
    console.log(data);
}
test();
