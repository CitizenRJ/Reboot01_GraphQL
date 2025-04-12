document.addEventListener('DOMContentLoaded', async () => {
    // Authentication check
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    
    // Logout function
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userId');
        window.location.href = 'index.html';
    });
    
    // GraphQL query function
    async function fetchGraphQL(query) {
        try {
            const response = await fetch('https://learn.reboot01.com/api/graphql-engine/v1/graphql', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ query })
            });
            
            if (!response.ok) {
                throw new Error('GraphQL query failed');
            }
            
            return await response.json();
        } catch (error) {
            console.error('GraphQL error:', error);
            return null;
        }
    }
    
    try {
        // 1. BASIC QUERY - Get user info
        const userQuery = `{
            user {
                id
                login
                firstName
                lastName
                attrs
            }
        }`;
        
        const userData = await fetchGraphQL(userQuery);
        if (!userData || !userData.data) throw new Error('Failed to fetch user data');
        
        const user = userData.data.user[0];
        
        // Display user info
        document.getElementById('user-info').innerHTML = `
            <div class="info-card">
                <p><strong>User ID:</strong> ${user.id}</p>
                <p><strong>Login:</strong> ${user.login}</p>
                <p><strong>Name:</strong> ${user.firstName || ''} ${user.lastName || ''}</p>
            </div>
        `;
        
        // 2. QUERY WITH ARGUMENTS - Get XP data for this user
        const xpQuery = `{
            transaction(
                where: {
                    type: {_eq: "xp"}, 
                    userId: {_eq: ${user.id}}
                },
                order_by: {createdAt: asc}
            ) {
                id
                amount
                createdAt
                path
                objectId
            }
        }`;
        
        const xpData = await fetchGraphQL(xpQuery);
        if (!xpData || !xpData.data) throw new Error('Failed to fetch XP data');
        
        const transactions = xpData.data.transaction;
        
        // Calculate total XP
        const totalXP = transactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Group XP by project path
        const xpByProject = transactions.reduce((acc, t) => {
            // Extract project name from path
            const pathParts = t.path.split('/');
            const projectName = pathParts[pathParts.length - 1];
            
            if (!acc[projectName]) {
                acc[projectName] = 0;
            }
            acc[projectName] += t.amount;
            return acc;
        }, {});
        
        // Display XP info
        let xpByProjectHTML = '';
        Object.entries(xpByProject)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([project, amount]) => {
                xpByProjectHTML += `<p><strong>${project}:</strong> ${amount} XP</p>`;
            });
        
        document.getElementById('xp-info').innerHTML = `
            <div class="info-card">
                <p><strong>Total XP:</strong> ${totalXP}</p>
                <h4>Top Projects by XP:</h4>
                ${xpByProjectHTML}
            </div>
        `;
        
        // 3. NESTED QUERY - Get project results with object details
        const progressQuery = `{
            progress(
                where: {userId: {_eq: ${user.id}}},
                order_by: {updatedAt: desc}
            ) {
                id
                grade
                createdAt
                updatedAt
                path
                object {
                    id
                    name
                    type
                }
            }
        }`;
        
        const progressData = await fetchGraphQL(progressQuery);
        if (!progressData || !progressData.data) throw new Error('Failed to fetch progress data');
        
        const progress = progressData.data.progress;
        
        // Calculate stats
        const passedProjects = progress.filter(p => p.grade > 0).length;
        const failedProjects = progress.filter(p => p.grade === 0).length;
        const totalProjects = progress.length;
        const passRate = totalProjects > 0 ? Math.round((passedProjects / totalProjects) * 100) : 0;
        
        // Format recent projects
        let recentProjectsHTML = '';
        progress.slice(0, 5).forEach(p => {
            const status = p.grade > 0 ? 'Passed' : 'Failed';
            const statusClass = p.grade > 0 ? 'status-passed' : 'status-failed';
            
            recentProjectsHTML += `
                <div class="project-item">
                    <span>${p.path.split('/').pop()}</span>
                    <span class="${statusClass}">${status}</span>
                </div>
            `;
        });
        
        document.getElementById('projects-info').innerHTML = `
            <div class="info-card">
                <div class="stats-row">
                    <div class="stat-box">
                        <span class="stat-value">${passedProjects}</span>
                        <span class="stat-label">Passed</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-value">${failedProjects}</span>
                        <span class="stat-label">Failed</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-value">${passRate}%</span>
                        <span class="stat-label">Pass Rate</span>
                    </div>
                </div>
                
                <h4>Recent Projects:</h4>
                <div class="project-list">
                    ${recentProjectsHTML}
                </div>
            </div>
        `;
        
        // Create SVG graphs
        createXpProgressGraph(transactions);
        createProjectRatioGraph(passedProjects, failedProjects);
        
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to load profile data. Please try logging in again.');
    }
});

// SVG Graph 1: XP Progression Over Time
function createXpProgressGraph(transactions) {
    const svg = document.getElementById('xp-time-graph');
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    const padding = 60;
    
    // Clear existing content
    svg.innerHTML = '';
    
    // Sort transactions by date and calculate cumulative XP
    let cumulativeXP = 0;
    const dataPoints = transactions.map(t => {
        cumulativeXP += t.amount;
        return {
            date: new Date(t.createdAt),
            xp: cumulativeXP
        };
    });
    
    if (dataPoints.length === 0) {
        const noDataText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        noDataText.textContent = 'No XP data available';
        noDataText.setAttribute('x', width / 2);
        noDataText.setAttribute('y', height / 2);
        noDataText.setAttribute('text-anchor', 'middle');
        noDataText.setAttribute('font-size', '16px');
        svg.appendChild(noDataText);
        return;
    }
    
    // Calculate scales
    const minDate = dataPoints[0].date;
    const maxDate = dataPoints[dataPoints.length - 1].date;
    const maxXP = dataPoints[dataPoints.length - 1].xp;
    
    const xScale = (date) => {
        const range = maxDate - minDate;
        return padding + ((date - minDate) / range) * (width - 2 * padding);
    };
    
    const yScale = (xp) => {
        return height - padding - (xp / maxXP) * (height - 2 * padding);
    };
    
    // Create axes
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', padding);
    xAxis.setAttribute('y1', height - padding);
    xAxis.setAttribute('x2', width - padding);
    xAxis.setAttribute('y2', height - padding);
    xAxis.setAttribute('stroke', '#333');
    xAxis.setAttribute('stroke-width', '2');
    
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', padding);
    yAxis.setAttribute('y1', padding);
    yAxis.setAttribute('x2', padding);
    yAxis.setAttribute('y2', height - padding);
    yAxis.setAttribute('stroke', '#333');
    yAxis.setAttribute('stroke-width', '2');
    
    svg.appendChild(xAxis);
    svg.appendChild(yAxis);
    
    // Add axis labels
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.textContent = 'Time';
    xLabel.setAttribute('x', width / 2);
    xLabel.setAttribute('y', height - 15);
    xLabel.setAttribute('text-anchor', 'middle');
    
    const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yLabel.textContent = 'Total XP';
    yLabel.setAttribute('x', 20);
    yLabel.setAttribute('y', height / 2);
    yLabel.setAttribute('transform', `rotate(-90, 20, ${height/2})`);
    yLabel.setAttribute('text-anchor', 'middle');
    
    svg.appendChild(xLabel);
    svg.appendChild(yLabel);
    
    // Add axis ticks and values
    // X-axis (time)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateRange = maxDate - minDate;
    const dayRange = dateRange / (1000 * 60 * 60 * 24);
    
    // Choose appropriate time intervals based on date range
    let timePoints = [];
    if (dayRange <= 30) {
        // For short periods, show individual days
        for (let i = 0; i <= dayRange; i += Math.max(1, Math.floor(dayRange / 5))) {
            const date = new Date(minDate.getTime() + i * 24 * 60 * 60 * 1000);
            timePoints.push(date);
        }
    } else {
        // For longer periods, show months
        let currentDate = new Date(minDate);
        while (currentDate <= maxDate) {
            timePoints.push(new Date(currentDate));
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    }
    
    timePoints.forEach(date => {
        const x = xScale(date);
        
        // Tick mark
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', height - padding);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', height - padding + 5);
        tick.setAttribute('stroke', '#333');
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.textContent = dayRange <= 30 
            ? `${date.getDate()}/${date.getMonth() + 1}` 
            : `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
        label.setAttribute('x', x);
        label.setAttribute('y', height - padding + 20);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '12px');
        
        svg.appendChild(tick);
        svg.appendChild(label);
    });
    
    // Y-axis (XP)
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const xpValue = (maxXP / yTicks) * i;
        const y = yScale(xpValue);
        
        // Tick mark
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', padding);
        tick.setAttribute('y1', y);
        tick.setAttribute('x2', padding - 5);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', '#333');
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.textContent = Math.round(xpValue).toLocaleString();
        label.setAttribute('x', padding - 10);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('font-size', '12px');
        
        svg.appendChild(tick);
        svg.appendChild(label);
        
        // Optional: Grid line
        const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gridLine.setAttribute('x1', padding);
        gridLine.setAttribute('y1', y);
        gridLine.setAttribute('x2', width - padding);
        gridLine.setAttribute('y2', y);
        gridLine.setAttribute('stroke', '#ddd');
        gridLine.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(gridLine);
    }
    
    // Create line path
    let pathData = '';
    dataPoints.forEach((point, i) => {
        const x = xScale(point.date);
        const y = yScale(point.xp);
        pathData += (i === 0) ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#3498db');
    path.setAttribute('stroke-width', '3');
    svg.appendChild(path);
    
    // Add area fill under the line
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', `${pathData} L ${xScale(maxDate)} ${height - padding} L ${xScale(minDate)} ${height - padding} Z`);
    areaPath.setAttribute('fill', 'rgba(52, 152, 219, 0.2)');
    svg.insertBefore(areaPath, path);
    
    // Add data points
    dataPoints.forEach(point => {
        const x = xScale(point.date);
        const y = yScale(point.xp);
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', '#3498db');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        
        // Add tooltip on hover
        circle.setAttribute('data-xp', point.xp);
        circle.setAttribute('data-date', point.date.toLocaleDateString());
        
        // Optional: Add hover effects
        circle.addEventListener('mouseover', function(e) {
            this.setAttribute('r', '6');
            
            // Create tooltip
            const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tooltip.setAttribute('id', 'tooltip');
            
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x + 10);
            rect.setAttribute('y', y - 30);
            rect.setAttribute('width', '120');
            rect.setAttribute('height', '45');
            rect.setAttribute('rx', '5');
            rect.setAttribute('fill', 'rgba(0,0,0,0.7)');
            
            const text1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text1.textContent = `XP: ${point.xp.toLocaleString()}`;
            text1.setAttribute('x', x + 20);
            text1.setAttribute('y', y - 12);
            text1.setAttribute('fill', 'white');
            text1.setAttribute('font-size', '12px');
            
            const text2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text2.textContent = point.date.toLocaleDateString();
            text2.setAttribute('x', x + 20);
            text2.setAttribute('y', y + 5);
            text2.setAttribute('fill', 'white');
            text2.setAttribute('font-size', '12px');
            
            tooltip.appendChild(rect);
            tooltip.appendChild(text1);
            tooltip.appendChild(text2);
            svg.appendChild(tooltip);
        });
        
        circle.addEventListener('mouseout', function() {
            this.setAttribute('r', '4');
            const tooltip = document.getElementById('tooltip');
            if (tooltip) {
                svg.removeChild(tooltip);
            }
        });
        
        svg.appendChild(circle);
    });
    
    // Add title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.textContent = 'XP Progression Over Time';
    title.setAttribute('x', width / 2);
    title.setAttribute('y', 30);
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('font-size', '16px');
    title.setAttribute('font-weight', 'bold');
    svg.appendChild(title);
}

// SVG Graph 2: Project Pass/Fail Distribution
function createProjectRatioGraph(passed, failed) {
    const svg = document.getElementById('project-ratio-graph');
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 60;
    
    // Clear existing content
    svg.innerHTML = '';
    
    const total = passed + failed;
    
    if (total === 0) {
        const noDataText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        noDataText.textContent = 'No project data available';
        noDataText.setAttribute('x', width / 2);
        noDataText.setAttribute('y', height / 2);
        noDataText.setAttribute('text-anchor', 'middle');
        noDataText.setAttribute('font-size', '16px');
        svg.appendChild(noDataText);
        return;
    }
    
    // Calculate angles for pie chart
    const passedPercent = passed / total;
    const passedAngle = passedPercent * 360;
    
    // Colors
    const passedColor = '#2ecc71';
    const failedColor = '#e74c3c';
    
    // Add title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.textContent = 'Project Pass/Fail Distribution';
    title.setAttribute('x', centerX);
    title.setAttribute('y', 30);
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('font-size', '16px');
    title.setAttribute('font-weight', 'bold');
    svg.appendChild(title);
    
    // Create donut chart (more modern than pie chart)
    const donutWidth = radius * 0.4; // Width of the donut ring
    
    // Inner circle (background/empty space)
    const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    innerCircle.setAttribute('cx', centerX);
    innerCircle.setAttribute('cy', centerY);
    innerCircle.setAttribute('r', radius - donutWidth);
    innerCircle.setAttribute('fill', '#f5f5f5');
    svg.appendChild(innerCircle);
    
    // Function to calculate SVG arc path
    function getArcPath(startAngle, endAngle, isLargeArc) {
        const startRad = (startAngle - 90) * Math.PI / 180; // -90 to start at top
        const endRad = (endAngle - 90) * Math.PI / 180;
        
        const x1 = centerX + radius * Math.cos(startRad);
        const y1 = centerY + radius * Math.sin(startRad);
        const x2 = centerX + radius * Math.cos(endRad);
        const y2 = centerY + radius * Math.sin(endRad);
        
        const x3 = centerX + (radius - donutWidth) * Math.cos(endRad);
        const y3 = centerY + (radius - donutWidth) * Math.sin(endRad);
        const x4 = centerX + (radius - donutWidth) * Math.cos(startRad);
        const y4 = centerY + (radius - donutWidth) * Math.sin(startRad);
        
        return `M ${x1} ${y1} A ${radius} ${radius} 0 ${isLargeArc} 1 ${x2} ${y2} 
                L ${x3} ${y3} A ${radius - donutWidth} ${radius - donutWidth} 0 ${isLargeArc} 0 ${x4} ${y4} Z`;
    }
    
    // Passed segment
    if (passed > 0) {
        const passedPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const isLargeArc = passedAngle > 180 ? 1 : 0;
        passedPath.setAttribute('d', getArcPath(0, passedAngle, isLargeArc));
        passedPath.setAttribute('fill', passedColor);
        svg.appendChild(passedPath);
    }
    
    // Failed segment
    if (failed > 0) {
        const failedPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const isLargeArc = (360 - passedAngle) > 180 ? 1 : 0;
        failedPath.setAttribute('d', getArcPath(passedAngle, 360, isLargeArc));
        failedPath.setAttribute('fill', failedColor);
        svg.appendChild(failedPath);
    }
    
    // Add centered text
    const percentText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    percentText.textContent = `${Math.round(passedPercent * 100)}%`;
    percentText.setAttribute('x', centerX);
    percentText.setAttribute('y', centerY);
    percentText.setAttribute('text-anchor', 'middle');
    percentText.setAttribute('dominant-baseline', 'middle');
    percentText.setAttribute('font-size', '32px');
    percentText.setAttribute('font-weight', 'bold');
    svg.appendChild(percentText);
    
    const passRateText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    passRateText.textContent = 'Pass Rate';
    passRateText.setAttribute('x', centerX);
    passRateText.setAttribute('y', centerY + 25);
    passRateText.setAttribute('text-anchor', 'middle');
    passRateText.setAttribute('font-size', '14px');
    svg.appendChild(passRateText);
    
    // Add legend
    const legendY = centerY + radius + 20;
    
    // Passed legend
    const passedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    passedRect.setAttribute('x', centerX - 70);
    passedRect.setAttribute('y', legendY);
    passedRect.setAttribute('width', '15');
    passedRect.setAttribute('height', '15');
    passedRect.setAttribute('fill', passedColor);
    
    const passedText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    passedText.textContent = `Passed: ${passed} (${Math.round(passedPercent * 100)}%)`;
    passedText.setAttribute('x', centerX - 50);
    passedText.setAttribute('y', legendY + 12);
    passedText.setAttribute('font-size', '14px');
    
    // Failed legend
    const failedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    failedRect.setAttribute('x', centerX - 70);
    failedRect.setAttribute('y', legendY + 25);
    failedRect.setAttribute('width', '15');
    failedRect.setAttribute('height', '15');
    failedRect.setAttribute('fill', failedColor);
    
    const failedText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    failedText.textContent = `Failed: ${failed} (${Math.round((failed / total) * 100)}%)`;
    failedText.setAttribute('x', centerX - 50);
    failedText.setAttribute('y', legendY + 37);
    failedText.setAttribute('font-size', '14px');
    
    svg.appendChild(passedRect);
    svg.appendChild(passedText);
    svg.appendChild(failedRect);
    svg.appendChild(failedText);
}