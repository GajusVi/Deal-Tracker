"""Start Deal Tracker locally:  python run.py  [--port 5050] [--no-browser]"""
import argparse
import threading
import webbrowser

from dealtracker.app import create_app


def main():
    ap = argparse.ArgumentParser(description="Deal Tracker - local PE deal management")
    ap.add_argument("--port", type=int, default=5050)
    ap.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to share on your network (no auth!)")
    ap.add_argument("--data", default=None, help="Data folder (default: ./data)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    app = create_app(args.data)
    url = f"http://127.0.0.1:{args.port}"
    print(f"\n  Deal Tracker running at {url}\n  Data folder: {app.config['DATA_DIR']}\n  Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
