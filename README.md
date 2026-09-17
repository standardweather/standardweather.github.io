<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Standard Weather Forensics & Consulting</title>
    <style>
        /* TYPOGRAPHY & COLOR STANDARDS */
        :root {
            --swfc-black: #000000;
            --swfc-bg: #F2F0E6; /* Approved cardstock background */
            --swfc-utility-grey: #E0E0E0;
        }

        body {
            background-color: var(--swfc-bg);
            color: var(--swfc-black);
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        /* STRUCTURAL GUIDELINES */
        .container {
            width: 100%;
            max-width: 800px;
            padding: 40px 20px;
            box-sizing: border-box;
        }

        header {
            text-align: center;
            border-bottom: 2px solid var(--swfc-black);
            padding-bottom: 40px;
            margin-bottom: 40px;
        }

        .logo {
            max-width: 250px;
            height: auto;
            margin-bottom: 20px;
            mix-blend-mode: multiply; /* Helps the off-white logo blend with the background */
        }

        h1, h2, h3 {
            text-transform: uppercase;
            font-weight: bold;
            margin-top: 0;
            letter-spacing: 1px;
        }

        h1 {
            font-size: 2rem;
            margin-bottom: 10px;
        }

        h2 {
            font-size: 1.5rem;
            border-bottom: 1px solid var(--swfc-black);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }

        p {
            margin-bottom: 20px;
            font-size: 1.1rem;
        }

        section {
            margin-bottom: 60px;
        }

        /* SERVICES GRID */
        .services-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 20px;
        }

        @media (min-width: 600px) {
            .services-grid {
                grid-template-columns: 1fr 1fr;
            }
        }

        .service-item {
            border: 1px solid var(--swfc-black);
            padding: 20px;
            background-color: var(--swfc-bg);
        }

        .service-item h3 {
            font-size: 1.2rem;
            border-bottom: none;
            margin-bottom: 10px;
            padding-bottom: 0;
        }

        /* CONTACT FORM */
        form {
            display: flex;
            flex-direction: column;
        }

        label {
            text-transform: uppercase;
            font-weight: bold;
            font-size: 0.9rem;
            margin-bottom: 5px;
        }

        input, textarea {
            font-family: inherit;
            background-color: transparent;
            border: 1px solid var(--swfc-black);
            padding: 10px;
            margin-bottom: 20px;
            color: var(--swfc-black);
            font-size: 1rem;
        }

        input:focus, textarea:focus {
            outline: none;
            background-color: #ffffff;
        }

        button {
            background-color: var(--swfc-black);
            color: #ffffff;
            border: none;
            padding: 15px;
            text-transform: uppercase;
            font-weight: bold;
            font-size: 1rem;
            cursor: pointer;
            letter-spacing: 1px;
        }

        button:hover {
            background-color: #333333;
        }

        footer {
            text-align: center;
            border-top: 2px solid var(--swfc-black);
            padding-top: 20px;
            margin-top: 20px;
            font-size: 0.9rem;
            text-transform: uppercase;
        }
    </style>
</head>
<body>

    <div class="container">
        
        <!-- HEADER / INTRO -->
        <header>
            <img src="watermarked_img_8306259053043064225.jpg" alt="Standard Weather Logo" class="logo">
            <h1>Standard Weather</h1>
            <p>Forensics & Consulting</p>
        </header>

        <!-- INTRODUCTION SECTION -->
        <section id="introduction">
            <h2>Introduction</h2>
            <p>The weather is factual. Our style is the same. We observe atmospheric conditions and provide objective data. We do not editorialize. The atmosphere exists; we observe it and report the metrics to you. Do with the data what you will.</p>
        </section>

        <!-- SERVICES SECTION -->
        <section id="services">
            <h2>Services</h2>
            <div class="services-grid">
                <div class="service-item">
                    <h3>Forensic Meteorology</h3>
                    <p>Reconstruction of past weather events. We supply certified historical data to determine exact atmospheric conditions at a specific time and location. Facts for legal, insurance, and investigative purposes.</p>
                </div>
                <div class="service-item">
                    <h3>Project Consulting</h3>
                    <p>Objective atmospheric analysis for operational planning. We review data models and present the statistical likelihood of specific weather conditions. No guarantees. Only probabilities.</p>
                </div>
            </div>
        </section>

        <!-- CONTACT SECTION -->
        <section id="contact">
            <h2>Contact Us</h2>
            <p>Submit your inquiry below. State your requirements clearly. Extraneous details will be ignored.</p>
            <form action="#" method="POST">
                <label for="name">Name</label>
                <input type="text" id="name" name="name" required>

                <label for="email">Email</label>
                <input type="email" id="email" name="email" required>

                <label for="inquiry">Nature of Inquiry</label>
                <textarea id="inquiry" name="inquiry" rows="5" required></textarea>

                <button type="submit">Submit Request</button>
            </form>
        </section>

        <!-- FOOTER -->
        <footer>
            <p>&copy; 2026 Standard Weather Forensics & Consulting. All data final.</p>
        </footer>

    </div>

</body>
</html>
